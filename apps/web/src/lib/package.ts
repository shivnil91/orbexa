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

/** Field order is the hash canonical form. Verify rebuilds this same object. */
export function packageBody(input: Omit<AgentPackage, "contentHash">): Omit<AgentPackage, "contentHash"> {
  return {
    id: input.id,
    packageVersion: input.packageVersion,
    createdAt: input.createdAt,
    immutable: true,
    kind: input.kind,
    sellerId: input.sellerId,
    slug: input.slug,
    name: input.name,
    specialty: input.specialty,
    intake: input.intake,
    rules: {
      products: input.rules.products,
      lenders: input.rules.lenders,
      cells: input.rules.cells,
    },
    calculators: input.calculators,
    playbooks: input.playbooks,
    documents: input.documents,
    templates: input.templates,
    handoff: input.handoff,
    tests: input.tests,
    proof: input.proof,
    routing: input.routing,
    trainingConsent: input.trainingConsent === true,
    exampleData: input.exampleData,
    instructions: input.instructions,
  };
}

export function packageContentHash(body: Omit<AgentPackage, "contentHash">): string {
  return createHash("sha256").update(JSON.stringify(packageBody(body))).digest("hex");
}

/** True when the stored bytes still match the hash written at seal time. */
export function verifyPackage(pack: AgentPackage | null | undefined): pack is AgentPackage {
  if (!pack || pack.immutable !== true || typeof pack.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(pack.contentHash)) return false;
  if (pack.sellerId.trim().length === 0 || pack.slug.trim().length === 0) return false;
  const { contentHash, ...rest } = pack;
  return packageContentHash(rest) === contentHash;
}

export function configFromPackage(pack: AgentPackage): StudioConfig {
  return {
    exampleData: pack.exampleData,
    specialty: pack.specialty,
    intake: pack.intake,
    products: pack.rules.products,
    lenders: pack.rules.lenders,
    cells: pack.rules.cells,
    calculators: pack.calculators,
    playbooks: pack.playbooks,
    templates: pack.templates,
    handoff: pack.handoff,
    cases: pack.tests,
  };
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
  const draft = packageBody({
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
  });
  const contentHash = packageContentHash(draft);
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
