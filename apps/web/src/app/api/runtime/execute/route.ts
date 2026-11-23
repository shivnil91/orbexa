import { connection, NextResponse } from "next/server";
import { logEvent } from "@/lib/log";
import { EXAMPLE_SELLER_ID } from "@/lib/marketplace";
import { absentProof, sealPackage } from "@/lib/package";
import { execute } from "@/lib/runtime";
import { exampleIntakeAnswers, NDIS_EXAMPLE_NAME, NDIS_EXAMPLE_SLUG, ndisStudioConfig } from "@/lib/studio-ndis";

export async function POST(request: Request) {
  await connection();
  if (process.env.ORBEXA_LOAD !== "1") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const started = Date.now();
  let need = "Example wages bridge";
  try {
    const body = await request.json() as { need?: unknown };
    if (typeof body.need === "string" && body.need.length > 0 && body.need.length <= 80) need = body.need;
  } catch {
    need = "Example wages bridge";
  }
  const pack = sealPackage({
    id: `pkg_${NDIS_EXAMPLE_SLUG}`,
    packageVersion: 1,
    sellerId: EXAMPLE_SELLER_ID,
    slug: NDIS_EXAMPLE_SLUG,
    name: NDIS_EXAMPLE_NAME,
    kind: "studio",
    config: ndisStudioConfig(),
    proof: absentProof(),
    instructions: "Apply the example package. Do not invent a lender or a rate.",
    trainingConsent: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const response = await execute({
    channel: "studio",
    package: pack,
    clientId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    sellerId: pack.sellerId,
    requestId: `load-${started}`,
    answers: exampleIntakeAnswers(),
    need,
    recordMemory: false,
  }, { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" });
  const durationMs = Date.now() - started;
  logEvent({ event: "request", route: "runtime", durationMs, status: response.error ? 422 : 200 });
  return NextResponse.json({
    ok: !response.error,
    error: response.error ?? null,
    coverage: response.coverage,
    durationMs,
  });
}
