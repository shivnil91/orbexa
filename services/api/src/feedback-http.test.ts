import assert from "node:assert/strict";
import test from "node:test";
import { acceptFeedback } from "./feedback-http.ts";

const ids = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  homeRegion: "local",
  jobId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

test("the feedback API refuses document text and founder authorisation", () => {
  const text = acceptFeedback({ ...ids, kind: "buyer_reject", body: "confidential tender" });
  assert.equal(text.ok, false);
  if (!text.ok) {
    assert.equal(text.status, 400);
  }
  const founder = acceptFeedback({ ...ids, kind: "buyer_approve", founderAuthorise: true });
  assert.equal(founder.ok, false);
  if (!founder.ok) {
    assert.equal(founder.status, 403);
  }
  const ok = acceptFeedback({ ...ids, kind: "buyer_approve" });
  assert.equal(ok.ok, true);
});
