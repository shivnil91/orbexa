import { createHash } from "node:crypto";
import type { ProofRecord } from "./demo-store.ts";
import { draftingModel, extractionModel, judgingModel } from "./model-router.ts";
import type { Playbook, StudioConfig } from "./studio-types.ts";

export type PackageProof = {
  status: ProofRecord["status"] | "absent";
  winRate: number;
  proven: boolean;
  fixture: boolean;
  version: number;
};

export type RoutingConfig = {
  draftingModel: string;
  extractionModel: string;
  judgingModel: string;
};

export type AgentPackage = {
  id: string;
  packageVersion: number;
  contentHash: string;
  createdAt: string;
  immutable: true;
  kind: "studio" | "listing";
  sellerId: string;
  slug: string;
  name: string;
  specialty: StudioConfig["specialty"];
  intake: StudioConfig["intake"];
  rules: { products: StudioConfig["products"]; lenders: StudioConfig["lenders"]; cells: StudioConfig["cells"] };
  calculators: StudioConfig["calculators"];
  playbooks: Playbook[];
  documents: { id: string; name: string; playbookId: string }[];
  templates: StudioConfig["templates"];
  handoff: StudioConfig["handoff"];
  tests: StudioConfig["cases"];
  proof: PackageProof;
  routing: RoutingConfig;
  trainingConsent: boolean;
  exampleData: boolean;
  instructions: string;
};

export type PackageInput = {
  id: string;
  packageVersion: number;
  sellerId: string;
  slug: string;
  name: string;
  kind: "studio" | "listing";
  config: StudioConfig;
  proof: PackageProof;
  instructions: string;
  trainingConsent: boolean;
  createdAt?: string;
  env?: Record<string, string | undefined>;
};

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function routingFrom(env: Record<string, string | undefined> = process.env): RoutingConfig {
  return {
    draftingModel: draftingModel(env),
    extractionModel: extractionModel(env),
    judgingModel: judgingModel(env),
  };
}

/** A sealed package is a snapshot. Later edits to the studio do not change it. */
export function sealPackage(input: PackageInput): AgentPackage {
  const config = structuredClone(input.config);
  const documents = config.playbooks.flatMap((playbook) => playbook.documents.map((name, index) => ({
    id: `doc:${playbook.id}:${index + 1}`,
    name,
    playbookId: playbook.id,
  })));
  const draft: Omit<AgentPackage, "contentHash"> = {
    id: input.id,
    packageVersion: input.packageVersion,
    createdAt: input.createdAt ?? new Date().toISOString(),
    immutable: true,
    kind: input.kind,
    sellerId: input.sellerId,
    slug: input.slug,
    name: input.name,
    specialty: config.specialty,
    intake: config.intake,
    rules: { products: config.products, lenders: config.lenders, cells: config.cells },
    calculators: config.calculators,
    playbooks: config.playbooks,
    documents,
    templates: config.templates,
    handoff: config.handoff,
    tests: config.cases,
    proof: input.proof,
    routing: routingFrom(input.env),
    trainingConsent: input.trainingConsent === true,
    exampleData: config.exampleData,
    instructions: input.instructions,
  };
  const contentHash = createHash("sha256").update(JSON.stringify(draft)).digest("hex");
  return freeze({ ...draft, contentHash });
}

export function listingConfig(instructions: string): StudioConfig {
  return {
    exampleData: false,
    specialty: { niche: instructions, audience: "", scope: [] },
    intake: [],
    products: [],
    lenders: [],
    cells: [],
    calculators: [],
    playbooks: [],
    templates: [],
    handoff: [],
    cases: [],
  };
}

export function absentProof(): PackageProof {
  return { status: "absent", winRate: 0, proven: false, fixture: true, version: 0 };
}
