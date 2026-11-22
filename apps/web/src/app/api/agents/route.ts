import { canSell } from "@/lib/accounts";
import { saveAgent, type AgentInput } from "@/lib/marketplace";
import type { KnowledgeNote } from "@/lib/demo-store";
import { redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

async function knowledgeFrom(form: FormData): Promise<{ notes: KnowledgeNote[]; error?: string }> {
  const notes: KnowledgeNote[] = [];
  const text = String(form.get("knowledgeText") ?? "").trim();
  if (text.length > 60_000) {
    return { notes, error: "knowledge" };
  }
  if (text) {
    notes.push({ name: "notes.txt", text });
  }
  const file = form.get("knowledgeFile");
  if (file instanceof File && file.size > 0) {
    if (file.size > 100_000) {
      return { notes: [], error: "knowledge" };
    }
    const body = (await file.text()).replace(/\u0000/g, "");
    if (!body.trim()) {
      return { notes, error: "knowledge" };
    }
    const name = file.name.replace(/[^\w.\- ]+/g, "").slice(0, 80) || "upload.txt";
    notes.push({ name, text: body.slice(0, 60_000) });
  }
  return { notes };
}

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  const slug = String(form.get("slug") ?? "");
  const back = slug ? `/${locale}/sell/${slug}` : `/${locale}/sell/new`;
  const user = await currentUser();
  if (!user) {
    return redirectTo(request, `/${locale}/sign-in`, { next: back });
  }
  if (!canSell(user.role)) {
    return redirectTo(request, `/${locale}/sell`, { error: "forbidden" });
  }
  const intent = String(form.get("intent") ?? "draft");
  if (intent !== "draft" && intent !== "publish" && intent !== "unpublish") {
    return redirectTo(request, back, { error: "generic" });
  }
  const knowledge = await knowledgeFrom(form);
  if (knowledge.error) {
    return redirectTo(request, back, { error: knowledge.error });
  }
  const input: AgentInput = {
    name: String(form.get("name") ?? ""),
    pitch: String(form.get("pitch") ?? ""),
    description: String(form.get("description") ?? ""),
    category: String(form.get("category") ?? ""),
    instructions: String(form.get("instructions") ?? ""),
    knowledge: knowledge.notes,
    exampleTitle: String(form.get("exampleTitle") ?? ""),
    exampleBody: String(form.get("exampleBody") ?? ""),
    priceRaw: String(form.get("price") ?? ""),
  };
  const saved = await saveAgent(user.id, input, intent, slug || undefined);
  if (!saved.ok) {
    return redirectTo(request, back, { error: saved.error });
  }
  const next = intent === "publish" ? `/${locale}/listings/${saved.slug}` : `/${locale}/sell/${saved.slug}`;
  return redirectTo(request, next);
}
