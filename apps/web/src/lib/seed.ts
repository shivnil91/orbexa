import { EXAMPLE_SELLER_ID, exampleListingSeeds } from "./marketplace.ts";
import { hashPassword } from "./accounts.ts";
import { emptyConnect, updateDb, type UserRecord } from "./demo-store.ts";
import { logEvent } from "./log.ts";
import { NDIS_EXAMPLE_SLUG, ndisStudioConfig } from "./studio-ndis.ts";
import { absentProof, sealPackage } from "./package.ts";
import type { ProofRecord } from "./demo-store.ts";

const SELLER_EMAIL = "example-seller@orbexa.invalid";

/** A finished fixture proof. The example page must not call a model to render. */
export function exampleNdisFixtureProof(id = "proof-example-ndis-broker"): ProofRecord {
  return {
    id,
    version: 1,
    status: "complete",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    model: "fixture",
    judgeModel: "fixture",
    fixture: true,
    tests: 4,
    wins: 3,
    ties: 1,
    losses: 0,
    winRate: 0.75,
    proven: false,
    rubric: [{ code: "grounded", agent: 1, baseline: 0 }],
    examples: [{
      task: "Example wages file",
      source: "seller_example",
      agentOutput: "A missing document is left blank.",
      baselineOutput: "A lender rate was not invented.",
      winner: "agent",
      agentScore: 1,
      baselineScore: 0,
    }],
    costMinor: 0,
    capped: false,
    sourceHash: "example-ndis-fixture",
  };
}

function exampleSeller(): UserRecord {
  const password = hashPassword("seed-not-a-login", "ab".repeat(16));
  return {
    id: EXAMPLE_SELLER_ID,
    email: SELLER_EMAIL,
    name: "Example seller",
    bio: "Seed profile for example listings. Not a real person or company.",
    role: "seller",
    passwordHash: password.hash,
    passwordSalt: password.salt,
    createdAt: "2026-01-01T00:00:00.000Z",
    connect: emptyConnect(),
    operator: false,
  };
}

/**
 * Idempotent. A complete proof is left in place, including a fixture proof,
 * so a dev task with a model key does not run a live proof during page render.
 */
export async function seedExamples(): Promise<{ listings: number; proof: "kept" | "written" }> {
  let proof: "kept" | "written" = "kept";
  await updateDb((db) => {
    db.exampleProofs = db.exampleProofs ?? {};
    const existing = db.exampleProofs[NDIS_EXAMPLE_SLUG];
    if (existing?.status === "complete") {
      proof = "kept";
    } else {
      db.exampleProofs[NDIS_EXAMPLE_SLUG] = exampleNdisFixtureProof(existing?.id);
      proof = "written";
    }
    if (!db.users.some((user) => user.id === EXAMPLE_SELLER_ID || user.email === SELLER_EMAIL)) {
      db.users.push(exampleSeller());
    }
  });
  const { getMarket } = await import("./repository.ts");
  const listings = exampleListingSeeds();
  const ndis = listings.find((row) => row.slug === NDIS_EXAMPLE_SLUG);
  await getMarket().seedExampleListings(listings.map((row) => ({
    id: row.id,
    slug: row.slug,
    sellerId: EXAMPLE_SELLER_ID,
    body: { slug: row.slug, name: row.name, pitch: row.pitch, priceMinor: row.priceMinor, category: row.category, example: true },
    package: row.slug === ndis?.slug
      ? sealPackage({
        id: `pkg_${NDIS_EXAMPLE_SLUG}`,
        packageVersion: 1,
        sellerId: EXAMPLE_SELLER_ID,
        slug: NDIS_EXAMPLE_SLUG,
        name: row.name,
        kind: "studio",
        config: ndisStudioConfig(),
        proof: absentProof(),
        instructions: "Apply the example package. Do not invent a lender or a rate.",
        trainingConsent: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      })
      : undefined,
  })));
  logEvent({ event: "seed", listings: listings.length, proof });
  return { listings: listings.length, proof };
}
