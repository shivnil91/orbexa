import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJob, payJob, readConsent, recordExpertSignal, recordJobFeedback, revealNext } from "./jobs.ts";

test("a buyer run keeps missing evidence and does not opt in by default", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-jobs-"));
  process.env.ORBEXA_JOB_DIR = directory;
  try {
    const job = await createJob({
      locale: "en",
      slug: "hospital-beds",
      tier: "expert_verified",
      intake: { opportunity_name: "Fictional beds" },
    });
    assert.equal(job.trainingConsent, false);
    assert.equal(await readConsent(job.tenantId), false);
    assert.equal(job.payment, null);
    const paid = await payJob(job.id);
    assert.equal(paid.status, "queued");
    assert.equal(paid.payment?.simulated, true);
    let current = paid;
    while (current.status === "queued" || current.status === "running") {
      current = await revealNext(current.id);
    }
    assert.equal(current.status, "waiting_for_expert");
    assert.equal(current.transcript?.matrix.every((row) => row.missing_evidence), true);
    assert.equal(current.transcript?.claims.some((claim) => claim.support_status === "supported" && claim.quote === "950 mm"), true);
    const signaled = await recordExpertSignal(current.id);
    assert.equal(signaled.approvalSignal, "approve");
    assert.equal(signaled.status, "waiting_for_buyer");
    const edited = await recordJobFeedback(current.id, { kind: "buyer_edit", editDistance: 12 });
    assert.equal(edited.feedback.at(-1)?.editDistance, 12);
    assert.equal(edited.status, "waiting_for_buyer");
  } finally {
    delete process.env.ORBEXA_JOB_DIR;
    await rm(directory, { recursive: true, force: true });
  }
});
