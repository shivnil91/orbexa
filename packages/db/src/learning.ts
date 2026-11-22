import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGoldenCase, rubricForCases } from "./golden.ts";

const goldenPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/hospital-beds/eval/v1.json",
);

export const CERTIFICATE_LESSON =
  "When a requested certificate is absent from the supplier notes, mark the claim missing_evidence and do not invent one.";

export const REGRESSION_LESSON = "Do not cite measurements from the supplier note.";

export type LearningDb = {
  exec(sql: string): Promise<unknown>;
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
};

type GoldenCase = {
  code: string;
  storageKey: string;
  expect: "missing_evidence" | "cite_width" | "fixed_stages";
};

type GoldenSuite = {
  name: string;
  fixtureKind: "synthetic" | "licensed";
  version: number;
  cases: GoldenCase[];
};

export type LessonBehavior = {
  missingCertificate: "missing_evidence" | "compliant" | "silent";
  citesWidth: boolean;
  keepsStageOrder: boolean;
};

export type LearningReport = {
  runId: string;
  groundedClaimRate: string | null;
  costMinor: string;
  latencyMs: number;
  revisionCount: number;
  rating: number | null;
  candidateIds: string[];
};

export type StageResult = {
  versionId: string;
  score: string;
  baselineScore: string;
  improved: boolean;
};

type JobRow = {
  id: string;
  tenant_id: string;
  home_region: string;
  run_id: string;
  agent_id: string;
  agent_version_id: string;
  status: string;
};

let goldenCache: GoldenSuite | undefined;

export async function loadGoldenSuite(): Promise<GoldenSuite> {
  if (goldenCache) {
    return goldenCache;
  }
  const parsed = JSON.parse(await readFile(goldenPath, "utf8")) as GoldenSuite;
  if (parsed.fixtureKind !== "synthetic" && parsed.fixtureKind !== "licensed") {
    throw new Error("golden suite must be synthetic or licensed");
  }
  goldenCache = parsed;
  return parsed;
}

export function extractLessonProposals(
  claims: readonly { body: string; support_status: string }[],
): string[] {
  const certificateGap = claims.some(
    (claim) => claim.support_status === "missing_evidence" && /certificate/i.test(claim.body),
  );
  return certificateGap ? [CERTIFICATE_LESSON] : [];
}

export function behaviorFromMemory(
  expertise: readonly string[],
  lessons: readonly string[],
): LessonBehavior {
  const lessonText = lessons.join("\n").toLowerCase();
  const combined = `${expertise.join("\n")}\n${lessonText}`.toLowerCase();
  let missingCertificate: LessonBehavior["missingCertificate"] = "silent";
  if (
    lessonText.includes("mark the requirement compliant") ||
    lessonText.includes("mark the claim compliant")
  ) {
    missingCertificate = "compliant";
  } else if (combined.includes("missing_evidence")) {
    missingCertificate = "missing_evidence";
  }
  return {
    missingCertificate,
    citesWidth: !lessonText.includes("do not cite measurements"),
    keepsStageOrder: !lessonText.includes("skip grounding") && !lessonText.includes("add a node"),
  };
}

export function scoreLessons(
  expertise: readonly string[],
  lessons: readonly string[],
  cases: readonly GoldenCase[],
): string {
  const behavior = behaviorFromMemory(expertise, lessons);
  if (cases.length === 0) {
    throw new Error("golden suite has no cases");
  }
  const passed = cases.filter((item) => {
    const expectation = loadGoldenCase(item).expectation;
    if (expectation === "missing_evidence") {
      return behavior.missingCertificate === "missing_evidence";
    }
    if (expectation === "cite_width") {
      return behavior.citesWidth;
    }
    return behavior.keepsStageOrder;
  }).length;
  return (passed / cases.length).toFixed(4);
}

export async function closeJobLearning(
  db: LearningDb,
  jobId: string,
  options?: { measuredLatencyMs?: number },
): Promise<LearningReport> {
  const job = await loadJob(db, jobId);
  if (job.status !== "accepted") {
    throw new Error("lessons are proposed only after a terminal job");
  }
  const existing = await db.query<{ id: string }>(
    "SELECT id::text FROM run_metrics WHERE run_id = $1 AND kind = 'final'",
    [job.run_id],
  );
  if (existing.rows.length > 0) {
    throw new Error("run metrics already recorded");
  }
  const suite = await ensureGoldenSuite(db, job.agent_id);
  await recordBaseline(db, job, suite);
  const claims = await db.query<{ body: string; support_status: string }>(
    "SELECT body, support_status FROM draft_claims WHERE job_id = $1 AND tenant_id = $2",
    [job.id, job.tenant_id],
  );
  const rate = await db.query<{ rate: string | null }>(
    `SELECT CASE
       WHEN count(*) = 0 THEN NULL
       ELSE round(
         count(*) FILTER (WHERE support_status = 'supported')::numeric / count(*),
         4
       )::text
     END AS rate
     FROM draft_claims
     WHERE job_id = $1 AND tenant_id = $2`,
    [job.id, job.tenant_id],
  );
  const spent = await db.query<{ cost: string; latency: string }>(
    `SELECT COALESCE(sum(cost_minor), 0)::text AS cost,
            COALESCE(sum(latency_ms), 0)::text AS latency
     FROM llm_invocations
     WHERE run_id = $1 AND tenant_id = $2`,
    [job.run_id, job.tenant_id],
  );
  const drafts = await db.query<{ revisions: string }>(
    "SELECT GREATEST(count(*) - 1, 0)::text AS revisions FROM drafts WHERE job_id = $1",
    [job.id],
  );
  const ratings = await db.query<{ score: number }>(
    "SELECT score FROM job_ratings WHERE job_id = $1 AND tenant_id = $2",
    [job.id, job.tenant_id],
  );
  const grounded = rate.rows[0]?.rate ?? null;
  const costMinor = spent.rows[0]?.cost ?? "0";
  const latencyMs = options?.measuredLatencyMs ?? Number(spent.rows[0]?.latency ?? 0);
  const revisionCount = Number(drafts.rows[0]?.revisions ?? 0);
  const rating = ratings.rows[0] ? Number(ratings.rows[0].score) : null;
  await db.query(
    `INSERT INTO run_metrics (
       tenant_id, home_region, job_id, run_id, agent_version_id, kind,
       grounded_claim_rate, cost_currency, cost_minor, latency_ms
     ) VALUES ($1, $2, $3, $4, $5, 'final', $6, 'USD', $7, $8)`,
    [job.tenant_id, job.home_region, job.id, job.run_id, job.agent_version_id, grounded, costMinor, latencyMs],
  );
  await evidence(db, job, null, "metrics_recorded", {
    grounded_claim_rate: grounded,
    cost_minor: costMinor,
    latency_ms: latencyMs,
  });
  await evidence(db, job, null, "feedback_recorded", {
    rating,
    revision_count: revisionCount,
  });
  const candidateIds: string[] = [];
  for (const proposal of extractLessonProposals(claims.rows)) {
    const reviewed = await reviewLessonCandidate(db, job.id, proposal);
    candidateIds.push(reviewed.id);
    await evidence(db, job, reviewed.id, reviewed.status === "rejected" ? "candidate_rejected" : "candidate_proposed", {
      permission_class: reviewed.permission_class,
      restriction: reviewed.rejection_reason,
    });
  }
  return {
    runId: job.run_id,
    groundedClaimRate: grounded,
    costMinor,
    latencyMs,
    revisionCount,
    rating,
    candidateIds,
  };
}

export async function reviewLessonCandidate(
  db: LearningDb,
  jobId: string,
  text: string,
): Promise<{ id: string; status: string; permission_class: string; rejection_reason: string | null }> {
  const inserted = await db.query<{ id: string }>(
    "SELECT app.review_lesson_candidate($1, $2)::text AS id",
    [jobId, text],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new Error("lesson review did not return an id");
  }
  const row = await db.query<{ status: string; permission_class: string; rejection_reason: string | null }>(
    `SELECT status, permission_class, rejection_reason
     FROM lesson_candidates WHERE id = $1`,
    [id],
  );
  const reviewed = row.rows[0];
  if (!reviewed) {
    throw new Error("lesson review row missing");
  }
  return { id, ...reviewed };
}

export async function stageLearnedVersion(
  db: LearningDb,
  input: { candidateId: string; actorUserId: string; embeddingModelId?: string },
): Promise<StageResult> {
  const candidate = await db.query<{
    id: string;
    tenant_id: string;
    source_job_id: string;
    proposed_text: string;
    status: string;
    scrub_status: string;
    permission_class: string;
    consent_grant_id: string | null;
  }>(
    `SELECT id::text, tenant_id::text, source_job_id::text, proposed_text, status,
            scrub_status, permission_class, consent_grant_id::text
     FROM lesson_candidates WHERE id = $1`,
    [input.candidateId],
  );
  const lesson = candidate.rows[0];
  if (!lesson || lesson.scrub_status !== "clear" || lesson.permission_class !== "same_region_abstracted") {
    throw new Error("no consent row means no promotion");
  }
  const job = await loadJob(db, lesson.source_job_id);
  const suite = await ensureGoldenSuite(db, job.agent_id);
  await recordBaseline(db, job, suite);
  const published = await publishedVersion(db, job.agent_id);
  const golden = await loadGoldenSuite();
  const expertise = await expertiseBodies(db, job.agent_id);
  const publishedLessons = await publishedLessonBodies(db, job.agent_id);
  const baselineScore = scoreLessons(expertise, publishedLessons, golden.cases);
  const score = scoreLessons(expertise, [...publishedLessons, lesson.proposed_text], golden.cases);
  const { judgeLessons } = await import("./judge.ts");
  const judged = judgeLessons(expertise, [...publishedLessons, lesson.proposed_text], golden.cases);
  const improved = Number(score) > Number(baselineScore);
  if (input.embeddingModelId && input.embeddingModelId !== published.embedding_model_id) {
    await db.query("SELECT app.reembed_fixture($1, $2)", [
      published.embedding_model_id,
      input.embeddingModelId,
    ]);
  }
  const nextVersion = await db.query<{ version: string }>(
    "SELECT (COALESCE(max(version), 0) + 1)::text AS version FROM agent_versions WHERE agent_id = $1",
    [job.agent_id],
  );
  const promptHash = createHash("sha256")
    .update(`${published.prompt_bundle_hash}\n${lesson.proposed_text}`)
    .digest("hex");
  const created = await db.query<{ id: string }>(
    `INSERT INTO agent_versions (
       agent_id, version, status, promotion_basis, previous_version_id, pipeline_hash,
       prompt_bundle_hash, tool_catalog_hash, model_route_id, embedding_model_id
     ) VALUES (
       $1, $2, 'draft', 'eval_improved', $3, $4, $5, $6, $7, $8
     ) RETURNING id::text`,
    [
      job.agent_id,
      Number(nextVersion.rows[0]?.version ?? 1),
      published.id,
      published.pipeline_hash,
      promptHash,
      published.tool_catalog_hash,
      published.model_route_id,
      input.embeddingModelId ?? published.embedding_model_id,
    ],
  );
  const versionId = created.rows[0]?.id;
  if (!versionId) {
    throw new Error("draft version was not created");
  }
  await db.query(
    `INSERT INTO eval_runs (
       agent_version_id, suite_id, suite_version_id, passed, score, judge_score, judge_passed, judge_rubric
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      versionId,
      suite.suiteId,
      suite.suiteVersionId,
      improved && judged.passed,
      score,
      judged.score,
      judged.passed,
      JSON.stringify(judged.rubric),
    ],
  );
  await db.query(
    `INSERT INTO version_approvals (
       creator_org_id, agent_version_id, candidate_id, scrubbed_text, status, actor_user_id
     ) VALUES ($1, $2, $3, $4, 'pending', $5)`,
    [published.creator_org_id, versionId, lesson.id, lesson.proposed_text, input.actorUserId],
  );
  await evidence(db, job, lesson.id, "eval_scored", {
    score,
    baseline_score: baselineScore,
    improved,
    agent_version_id: versionId,
  });
  return { versionId, score, baselineScore, improved };
}

export async function approveLearnedVersion(
  db: LearningDb,
  versionId: string,
  actorUserId: string,
): Promise<void> {
  const updated = await db.query<{ candidate_id: string }>(
    `UPDATE version_approvals
     SET status = 'approved', actor_user_id = $2, decided_at = now()
     WHERE agent_version_id = $1 AND status = 'pending'
     RETURNING candidate_id::text`,
    [versionId, actorUserId],
  );
  const candidateId = updated.rows[0]?.candidate_id;
  if (!candidateId) {
    throw new Error("creator approval required");
  }
  const job = await jobForCandidate(db, candidateId);
  await evidence(db, job, candidateId, "creator_approved", { agent_version_id: versionId });
}

export async function publishLearnedVersion(
  db: LearningDb,
  versionId: string,
  candidateId: string,
  actorUserId: string,
): Promise<string> {
  const lesson = await db.query<{ proposed_text: string }>(
    "SELECT proposed_text FROM lesson_candidates WHERE id = $1",
    [candidateId],
  );
  const lessonText = lesson.rows[0]?.proposed_text;
  if (lessonText === undefined) {
    throw new Error("lesson candidate not found");
  }
  const published = await db.query<{ id: string }>(
    "SELECT app.publish_learned_version($1, $2, $3, $4)::text AS id",
    [versionId, candidateId, actorUserId, createHash("sha256").update(lessonText).digest("hex")],
  );
  const snapshotId = published.rows[0]?.id;
  if (!snapshotId) {
    throw new Error("publish did not return a snapshot");
  }
  const job = await jobForCandidate(db, candidateId);
  await evidence(db, job, candidateId, "version_published", {
    agent_version_id: versionId,
    memory_snapshot_id: snapshotId,
  });
  return snapshotId;
}

export async function rejectLesson(db: LearningDb, candidateId: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE lesson_candidates
     SET status = 'rejected', rejection_reason = $2, decided_at = now()
     WHERE id = $1 AND status = 'proposed'`,
    [candidateId, reason],
  );
  const job = await jobForCandidate(db, candidateId);
  await evidence(db, job, candidateId, "candidate_rejected", { reason });
}

export async function rollbackLearnedVersion(db: LearningDb, versionId: string): Promise<void> {
  const candidate = await db.query<{ candidate_id: string }>(
    "SELECT candidate_id::text FROM version_approvals WHERE agent_version_id = $1",
    [versionId],
  );
  await db.query("SELECT app.rollback_agent_version($1)", [versionId]);
  const candidateId = candidate.rows[0]?.candidate_id;
  if (candidateId) {
    const job = await jobForCandidate(db, candidateId);
    await evidence(db, job, candidateId, "version_rolled_back", { agent_version_id: versionId });
  }
}

export async function publishedBehaviorScore(db: LearningDb, agentId: string): Promise<string> {
  const golden = await loadGoldenSuite();
  const expertise = await expertiseBodies(db, agentId);
  const lessons = await publishedLessonBodies(db, agentId);
  return scoreLessons(expertise, lessons, golden.cases);
}

async function loadJob(db: LearningDb, jobId: string): Promise<JobRow> {
  const rows = await db.query<JobRow>(
    `SELECT job.id::text, job.tenant_id::text, job.home_region, run.id::text AS run_id,
            version.agent_id::text, job.agent_version_id::text, job.status
     FROM jobs AS job
     JOIN job_runs AS run ON run.job_id = job.id AND run.tenant_id = job.tenant_id
     JOIN agent_versions AS version ON version.id = job.agent_version_id
     WHERE job.id = $1
     ORDER BY run.started_at
     LIMIT 1`,
    [jobId],
  );
  const job = rows.rows[0];
  if (!job) {
    throw new Error("job not found");
  }
  return job;
}

async function ensureGoldenSuite(
  db: LearningDb,
  agentId: string,
): Promise<{ suiteId: string; suiteVersionId: string }> {
  const golden = await loadGoldenSuite();
  const existing = await db.query<{ id: string }>(
    "SELECT id::text FROM eval_suites WHERE agent_id = $1 AND name = $2",
    [agentId, golden.name],
  );
  let suiteId = existing.rows[0]?.id;
  if (!suiteId) {
    const inserted = await db.query<{ id: string }>(
      "INSERT INTO eval_suites (agent_id, name) VALUES ($1, $2) RETURNING id::text",
      [agentId, golden.name],
    );
    suiteId = inserted.rows[0]?.id;
  }
  if (!suiteId) {
    throw new Error("eval suite was not created");
  }
  const versions = await db.query<{ id: string }>(
    "SELECT id::text FROM eval_suite_versions WHERE suite_id = $1 AND version = $2",
    [suiteId, golden.version],
  );
  let suiteVersionId = versions.rows[0]?.id;
  if (!suiteVersionId) {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO eval_suite_versions (suite_id, version, fixture_kind, rubric)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING id::text`,
      [suiteId, golden.version, golden.fixtureKind, JSON.stringify(rubricForCases(golden.cases))],
    );
    suiteVersionId = inserted.rows[0]?.id;
  }
  if (!suiteVersionId) {
    throw new Error("eval suite version was not created");
  }
  for (const item of golden.cases) {
    const found = await db.query<{ id: string }>(
      "SELECT id::text FROM eval_cases WHERE suite_id = $1 AND code = $2",
      [suiteId, item.code],
    );
    if (found.rows.length > 0) {
      continue;
    }
    await db.query(
      `INSERT INTO eval_cases (suite_id, suite_version_id, code, fixture_storage_key, expectation)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [suiteId, suiteVersionId, item.code, item.storageKey, JSON.stringify({ result: item.expect })],
    );
  }
  return { suiteId, suiteVersionId };
}

async function recordBaseline(
  db: LearningDb,
  job: JobRow,
  suite: { suiteId: string; suiteVersionId: string },
): Promise<void> {
  const published = await publishedVersion(db, job.agent_id);
  const existing = await db.query<{ id: string }>(
    "SELECT id::text FROM eval_runs WHERE agent_version_id = $1 AND suite_id = $2",
    [published.id, suite.suiteId],
  );
  if (existing.rows.length > 0) {
    return;
  }
  const golden = await loadGoldenSuite();
  const expertise = await expertiseBodies(db, job.agent_id);
  const lessons = await publishedLessonBodies(db, job.agent_id);
  const score = scoreLessons(expertise, lessons, golden.cases);
  const { judgeLessons } = await import("./judge.ts");
  const judged = judgeLessons(expertise, lessons, golden.cases);
  await db.query(
    `INSERT INTO eval_runs (
       agent_version_id, suite_id, suite_version_id, passed, score, judge_score, judge_passed, judge_rubric
     ) VALUES ($1, $2, $3, true, $4, $5, $6, $7::jsonb)`,
    [
      published.id,
      suite.suiteId,
      suite.suiteVersionId,
      score,
      judged.score,
      judged.passed,
      JSON.stringify(judged.rubric),
    ],
  );
}

async function publishedVersion(db: LearningDb, agentId: string): Promise<{
  id: string;
  creator_org_id: string;
  embedding_model_id: string;
  pipeline_hash: string;
  prompt_bundle_hash: string;
  tool_catalog_hash: string;
  model_route_id: string;
}> {
  const rows = await db.query<{
    id: string;
    creator_org_id: string;
    embedding_model_id: string;
    pipeline_hash: string;
    prompt_bundle_hash: string;
    tool_catalog_hash: string;
    model_route_id: string;
  }>(
    `SELECT version.id::text, agent.creator_org_id::text, version.embedding_model_id::text,
            version.pipeline_hash, version.prompt_bundle_hash, version.tool_catalog_hash,
            version.model_route_id::text
     FROM agent_versions AS version
     JOIN agents AS agent ON agent.id = version.agent_id
     WHERE version.agent_id = $1 AND version.status = 'published'`,
    [agentId],
  );
  const version = rows.rows[0];
  if (!version) {
    throw new Error("published version not found");
  }
  return version;
}

async function expertiseBodies(db: LearningDb, agentId: string): Promise<string[]> {
  const rows = await db.query<{ body: string }>(
    `SELECT body FROM memory_items
     WHERE scope = 'creator_expertise' AND agent_id = $1 AND status = 'active' AND deleted_at IS NULL
     ORDER BY created_at`,
    [agentId],
  );
  return rows.rows.map((row) => row.body);
}

async function publishedLessonBodies(db: LearningDb, agentId: string): Promise<string[]> {
  const rows = await db.query<{ body: string }>(
    `SELECT item.body
     FROM agent_versions AS version
     JOIN memory_snapshot_items AS pinned ON pinned.snapshot_id = version.memory_snapshot_id
     JOIN memory_items AS item ON item.id = pinned.memory_item_id
     WHERE version.agent_id = $1
       AND version.status = 'published'
       AND item.scope = 'approved_reusable'
       AND item.status = 'active'
     ORDER BY item.created_at`,
    [agentId],
  );
  return rows.rows.map((row) => row.body);
}

async function jobForCandidate(db: LearningDb, candidateId: string): Promise<JobRow> {
  const rows = await db.query<{ source_job_id: string }>(
    "SELECT source_job_id::text FROM lesson_candidates WHERE id = $1",
    [candidateId],
  );
  const jobId = rows.rows[0]?.source_job_id;
  if (!jobId) {
    throw new Error("lesson candidate not found");
  }
  return loadJob(db, jobId);
}

async function evidence(
  db: LearningDb,
  job: JobRow,
  candidateId: string | null,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `INSERT INTO learning_evidence (
       tenant_id, home_region, job_id, run_id, agent_version_id, candidate_id, action, detail
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      job.tenant_id,
      job.home_region,
      job.id,
      job.run_id,
      job.agent_version_id,
      candidateId,
      action,
      JSON.stringify(detail),
    ],
  );
}
