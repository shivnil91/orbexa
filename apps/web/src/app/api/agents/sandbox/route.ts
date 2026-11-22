import { NextResponse } from "next/server";
import { sandboxReply } from "@/lib/marketplace";

const buckets = new Map<string, { count: number; resetAt: number }>();

function allowed(key: string): boolean {
  const now = Date.now();
  const row = buckets.get(key) ?? { count: 0, resetAt: now + 60_000 };
  if (now > row.resetAt) {
    row.count = 0;
    row.resetAt = now + 60_000;
  }
  row.count += 1;
  buckets.set(key, row);
  return row.count <= 8;
}

export async function POST(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allowed(forwarded) || !allowed("all")) {
    return NextResponse.json({ error: "cap" }, { status: 429 });
  }
  const form = await request.formData();
  const need = String(form.get("sample") ?? "").trim();
  const instructions = String(form.get("instructions") ?? "").trim();
  const knowledge = String(form.get("knowledgeText") ?? "").trim();
  if (need.length < 3 || need.length > 2_000 || instructions.length < 8 || instructions.length > 8_000) {
    return NextResponse.json({ error: "need" }, { status: 400 });
  }
  return NextResponse.json({
    paragraphs: sandboxReply({
      name: String(form.get("name") ?? "").slice(0, 120),
      instructions,
      knowledge: knowledge.slice(0, 2_000),
      need,
    }),
    provider: "fixture",
  });
}
