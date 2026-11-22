import assert from "node:assert/strict";
import test from "node:test";
import { validateFeedback } from "./feedback.ts";

test("feedback rejects document text and a training grant", () => {
  assert.throws(
    () =>
      validateFeedback({
        tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        homeRegion: "local",
        jobId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        kind: "buyer_edit",
        editDistance: 4,
        body: "the buyer tender text",
      } as never),
    /document text/,
  );
  assert.throws(
    () =>
      validateFeedback({
        tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        homeRegion: "local",
        jobId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        kind: "buyer_approve",
        founderAuthorise: true,
      } as never),
    /training grant/,
  );
});

test("a rubric code cannot carry customer text", () => {
  assert.throws(
    () =>
      validateFeedback({
        tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        homeRegion: "local",
        jobId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        kind: "judge_score",
        rubricCode: "the buyer tender says the width is secret",
        score: 1,
      }),
    /rubric code/,
  );
});

test("an approve signal is a reward and not a document", () => {
  const row = validateFeedback({
    tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    homeRegion: "local",
    jobId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    kind: "buyer_approve",
  });
  assert.equal(row.kind, "buyer_approve");
});
