import assert from "node:assert/strict";
import test from "node:test";
import {
  CERTIFICATE_LESSON,
  REGRESSION_LESSON,
  extractLessonProposals,
  loadGoldenSuite,
  scoreLessons,
} from "./learning.ts";

const secret = "WARD-LAYOUT-A-991 stays inside Northwind Clinics only.";

test("lesson extraction keeps buyer text out of the proposal", async () => {
  const proposals = extractLessonProposals([
    {
      support_status: "missing_evidence",
      body: `A regulatory certificate was requested. ${secret}`,
    },
    { support_status: "supported", body: secret },
  ]);
  assert.deepEqual(proposals, [CERTIFICATE_LESSON]);
  assert.equal(proposals.join(" ").includes("WARD-LAYOUT"), false);
});

test("the fixture scorer rejects a regression and accepts the certificate lesson", async () => {
  const suite = await loadGoldenSuite();
  const expertise = ["Record measurements that are already written in the supplier note."];
  assert.equal(scoreLessons(expertise, [], suite.cases), "0.6667");
  assert.equal(scoreLessons(expertise, [REGRESSION_LESSON], suite.cases), "0.3333");
  assert.equal(scoreLessons(expertise, [CERTIFICATE_LESSON], suite.cases), "1.0000");
});
