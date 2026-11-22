import { cookies } from "next/headers";
import { canSell, registerAccount, sessionCookie, updateAccount } from "@/lib/accounts";
import { isListingSlug, saveAgent, type AgentInput } from "@/lib/marketplace";
import type { KnowledgeNote } from "@/lib/demo-store";
import { requestIsSecure } from "@/lib/request-guard";
import { formLocale, redirectTo } from "@/server/http";
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
  const locale = formLocale(form);
  const slug = String(form.get("slug") ?? "");
  const skill = String(form.get("skill") ?? "");
  if (slug && !isListingSlug(slug)) {
    return redirectTo(request, `/${locale}/earn`, { error: "missing", skill });
  }
  const back = slug ? `/${locale}/sell/${slug}` : `/${locale}/earn`;
  let user = await currentUser();
  if (!user && !String(form.get("accountName") ?? "").trim() && !String(form.get("email") ?? "").trim()) {
    return redirectTo(request, `/${locale}/sign-in`, { next: back });
  }
  if (!user) {
    const registered = await registerAccount({
      name: String(form.get("accountName") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      role: "seller",
      operatorCode: "",
    });
    if (!registered.ok) {
      return redirectTo(request, back, { error: registered.error, skill });
    }
    const jar = await cookies();
    jar.set(sessionCookie(registered.token, requestIsSecure(request)));
    user = registered.user;
  }
  if (!canSell(user.role)) {
    const upgraded = await updateAccount(user.id, { name: user.name, bio: user.bio, role: "both" });
    if (!upgraded.ok) {
      return redirectTo(request, back, { error: upgraded.error, skill });
    }
  }
  const intent = String(form.get("intent") ?? "draft");
  if (intent !== "draft" && intent !== "publish" && intent !== "unpublish") {
    return redirectTo(request, back, { error: "generic", skill });
  }
  const knowledge = await knowledgeFrom(form);
  if (knowledge.error) {
    return redirectTo(request, back, { error: knowledge.error, skill });
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
    return redirectTo(request, back, { error: saved.error, skill });
  }
  const next = intent === "publish" ? `/${locale}/listings/${saved.slug}` : `/${locale}/sell/${saved.slug}`;
  return redirectTo(request, next);
}
