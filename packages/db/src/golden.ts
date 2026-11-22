import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export type GoldenExpectation = "missing_evidence" | "cite_width" | "fixed_stages";

export type GoldenCaseRef = {
  code: string;
  storageKey: string;
  expect: GoldenExpectation;
};

export type GoldenCaseFile = {
  code: string;
  fixtureKind: "synthetic" | "licensed";
  expectation: GoldenExpectation;
  rubric: string[];
  task: string;
};

export function goldenCasePath(storageKey: string): string {
  if (storageKey.includes("..") || !storageKey.startsWith("fixtures/")) {
    throw new Error("golden case path is not allowed");
  }
  if (!storageKey.includes("/synthetic/") && !storageKey.includes("/licensed/")) {
    throw new Error("golden case must be synthetic or licensed");
  }
  const full = path.resolve(repoRoot, storageKey);
  const relative = path.relative(repoRoot, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("golden case path is not allowed");
  }
  return full;
}

export function loadGoldenCase(item: GoldenCaseRef): GoldenCaseFile {
  const parsed = JSON.parse(readFileSync(goldenCasePath(item.storageKey), "utf8")) as Partial<GoldenCaseFile>;
  if (parsed.code !== item.code) {
    throw new Error(`case file ${item.code} does not match the manifest`);
  }
  if (parsed.fixtureKind !== "synthetic" && parsed.fixtureKind !== "licensed") {
    throw new Error(`case file ${item.code} must be synthetic or licensed`);
  }
  if (parsed.expectation !== item.expect) {
    throw new Error(`case file ${item.code} does not match the manifest`);
  }
  if (!Array.isArray(parsed.rubric) || parsed.rubric.some((code) => typeof code !== "string")) {
    throw new Error(`case file ${item.code} has no rubric`);
  }
  if (typeof parsed.task !== "string" || parsed.task.length < 8) {
    throw new Error(`case file ${item.code} has no task`);
  }
  return {
    code: parsed.code,
    fixtureKind: parsed.fixtureKind,
    expectation: parsed.expectation,
    rubric: parsed.rubric,
    task: parsed.task,
  };
}

export function rubricForCases(cases: readonly GoldenCaseRef[]): string[] {
  const codes = new Set<string>();
  for (const item of cases) {
    for (const code of loadGoldenCase(item).rubric) {
      codes.add(code);
    }
  }
  return [...codes];
}
