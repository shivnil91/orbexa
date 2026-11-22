import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CERTIFICATE_LESSON, REGRESSION_LESSON, loadGoldenSuite, scoreLessons } from "./learning.ts";
import { judgeLessons, judgeMode, judgePrompt } from "./judge.ts";

const baselinePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/hospital-beds/eval/baseline.json",
);

test("golden lesson scores do not fall below the committed baseline", async () => {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
    lessons: { expertise_only: string; regression: string; certificate: string };
    judge_certificate: string;
  };
  const suite = await loadGoldenSuite();
  const expertise = ["Record measurements that are already written in the supplier note."];
  assert.ok(Number(scoreLessons(expertise, [], suite.cases)) >= Number(baseline.lessons.expertise_only));
  assert.ok(
    Number(scoreLessons(expertise, [REGRESSION_LESSON], suite.cases)) >= Number(baseline.lessons.regression),
  );
  assert.ok(
    Number(scoreLessons(expertise, [CERTIFICATE_LESSON], suite.cases)) >= Number(baseline.lessons.certificate),
  );
  const judged = judgeLessons(expertise, [CERTIFICATE_LESSON], suite.cases);
  assert.equal(judged.mode, "simulated");
  assert.equal(judged.passed, true);
  assert.ok(Number(judged.score) >= Number(baseline.judge_certificate));
  assert.equal(judgeMode({}), "simulated");
  assert.equal(judgePrompt(expertise, [CERTIFICATE_LESSON], suite.cases).includes("sk_live_"), false);
});
