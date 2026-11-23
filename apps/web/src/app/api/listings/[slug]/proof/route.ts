import { NextResponse } from "next/server";
import { findItem, isListingSlug } from "@/lib/marketplace";
import { loadCatalog } from "@/server/catalog";
import { currentUser } from "@/server/session";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isListingSlug(slug)) {
    return NextResponse.json({ error: "missing" }, { status: 404 });
  }
  const user = await currentUser();
  const item = findItem(await loadCatalog(), slug, user?.id, user?.admin ?? false);
  if (!item) {
    return NextResponse.json({ error: "missing" }, { status: 404 });
  }
  const proof = item.proof;
  return NextResponse.json({
    status: proof?.status ?? "none",
    proven: proof?.proven ?? false,
    wins: proof?.wins ?? 0,
    tests: proof?.tests ?? 0,
    fixture: proof?.fixture ?? true,
    winRate: proof?.winRate ?? 0,
  });
}
