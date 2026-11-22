export const FEEDBACK_KINDS = [
  "buyer_approve",
  "buyer_edit",
  "buyer_reject",
  "edit_distance",
  "tender_win",
  "tender_loss",
  "judge_score",
  "expert_rating",
] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export type FeedbackInput = {
  tenantId: string;
  homeRegion: string;
  jobId: string;
  runId?: string | null;
  kind: FeedbackKind;
  reward?: number | null;
  editDistance?: number | null;
  rubricCode?: string | null;
  score?: number | null;
  rating?: number | null;
  chosenHash?: string | null;
  rejectedHash?: string | null;
  preferenceSource?: "buyer" | "expert" | "judge" | null;
};

export type FeedbackDb = {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
};

const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REWARDS: Record<FeedbackKind, number> = {
  buyer_approve: 1,
  buyer_edit: 0,
  buyer_reject: -1,
  edit_distance: 0,
  tender_win: 1,
  tender_loss: -1,
  judge_score: 0,
  expert_rating: 0,
};

export function validateFeedback(input: FeedbackInput): FeedbackInput {
  const record = input as FeedbackInput & Record<string, unknown>;
  for (const banned of ["body", "text", "prompt", "document", "note", "founderAuthorise"]) {
    if (banned in record && record[banned] != null && record[banned] !== false) {
      throw new Error("feedback must not include document text or a training grant");
    }
  }
  if (!UUID.test(input.tenantId) || !UUID.test(input.jobId)) {
    throw new Error("feedback tenant and job must be uuids");
  }
  if (!FEEDBACK_KINDS.includes(input.kind)) {
    throw new Error("unknown feedback kind");
  }
  if (input.reward != null && (input.reward < -1 || input.reward > 1)) {
    throw new Error("reward is out of range");
  }
  if (input.kind === "edit_distance" && (input.editDistance == null || input.editDistance < 0)) {
    throw new Error("edit distance is required");
  }
  if (input.kind === "buyer_edit" && input.editDistance != null && input.editDistance < 0) {
    throw new Error("edit distance is required");
  }
  if (input.kind === "expert_rating" && (input.rating == null || input.rating < 1 || input.rating > 5)) {
    throw new Error("expert rating must be from 1 to 5");
  }
  if (input.kind === "judge_score" && (input.score == null || !input.rubricCode)) {
    throw new Error("judge score needs a rubric code");
  }
  if (input.chosenHash != null && !HASH.test(input.chosenHash)) {
    throw new Error("preference hash must be sha256");
  }
  if (input.rejectedHash != null && !HASH.test(input.rejectedHash)) {
    throw new Error("preference hash must be sha256");
  }
  return input;
}

export function rewardFor(kind: FeedbackKind, score?: number | null, rating?: number | null): number {
  if (kind === "judge_score" && score != null) {
    return Math.max(-1, Math.min(1, score * 2 - 1));
  }
  if (kind === "expert_rating" && rating != null) {
    return Math.max(-1, Math.min(1, (rating - 3) / 2));
  }
  return REWARDS[kind];
}

export async function insertFeedback(db: FeedbackDb, input: FeedbackInput): Promise<string> {
  const row = validateFeedback(input);
  const reward = row.reward ?? rewardFor(row.kind, row.score, row.rating);
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO feedback_events (
       tenant_id, home_region, job_id, run_id, kind, reward, edit_distance, rubric_code, score, rating
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id::text AS id`,
    [
      row.tenantId,
      row.homeRegion,
      row.jobId,
      row.runId ?? null,
      row.kind,
      reward,
      row.editDistance ?? null,
      row.rubricCode ?? null,
      row.score ?? null,
      row.rating ?? null,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new Error("feedback was not recorded");
  }
  if (row.chosenHash && row.rejectedHash && row.preferenceSource) {
    await db.query(
      `INSERT INTO preference_pairs (
         tenant_id, home_region, job_id, chosen_hash, rejected_hash, source
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.tenantId, row.homeRegion, row.jobId, row.chosenHash, row.rejectedHash, row.preferenceSource],
    );
  }
  return id;
}

export async function setTrainingConsent(
  db: FeedbackDb,
  input: { orgId: string; homeRegion: string; granted: boolean; userId: string | null },
): Promise<void> {
  if (!UUID.test(input.orgId)) {
    throw new Error("org id must be a uuid");
  }
  if (input.granted) {
    await db.query(
      `INSERT INTO training_consents (org_id, home_region, granted, granted_by, granted_at)
       VALUES ($1, $2, true, $3, now())
       ON CONFLICT (org_id) DO UPDATE
         SET granted = true, granted_by = EXCLUDED.granted_by, granted_at = now(), revoked_at = NULL`,
      [input.orgId, input.homeRegion, input.userId],
    );
    return;
  }
  await db.query(
    `INSERT INTO training_consents (org_id, home_region, granted, revoked_at)
     VALUES ($1, $2, false, now())
     ON CONFLICT (org_id) DO UPDATE
       SET granted = false, revoked_at = now(), granted_by = NULL, granted_at = NULL`,
    [input.orgId, input.homeRegion],
  );
}
