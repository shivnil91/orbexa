import { NextResponse } from "next/server";
import { canSell } from "@/lib/accounts";
import { sandboxReply } from "@/lib/marketplace";
import { currentUser } from "@/server/session";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || !canSell(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }
  const form = await request.formData();
  const need = String(form.get("sample") ?? "").trim();
  const instructions = String(form.get("instructions") ?? "").trim();
  const knowledge = String(form.get("knowledgeText") ?? "").trim();
  if (need.length < 3 || instructions.length < 8) {
    return NextResponse.json({ error: "need" }, { status: 400 });
  }
  return NextResponse.json({
    paragraphs: sandboxReply({
      name: String(form.get("name") ?? ""),
      instructions,
      knowledge,
      need,
    }),
  });
}
