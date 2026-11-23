import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { after } from "next/server";
import { canSell, registerAccount, sessionCookie, updateAccount } from "@/lib/accounts";
import type { AssetKind, InterviewAnswer, KnowledgeAsset, KnowledgeNote } from "@/lib/demo-store";
import { isListingSlug, saveAgent, type AgentInput } from "@/lib/marketplace";
import { scheduleProof } from "@/lib/proof";
import { requestIsSecure } from "@/lib/request-guard";
import { acceptKnowledgeFile, INTERVIEW } from "@/lib/trust";
import { formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

const KINDS = new Set<AssetKind>(["template", "checklist", "example", "rule"]);

function asset(kind: AssetKind, name: string, text: string): KnowledgeAsset | null {
  const body = text.replace(/\u0000/g, "").trim();
  if (!body) return null;
  return { id: randomUUID(), kind, name, text: body.slice(0, 60_000) };
}

async function knowledgeFrom(form: FormData): Promise<{ notes: KnowledgeNote[]; assets: KnowledgeAsset[]; interview: InterviewAnswer[]; error?: string }> {
  const assets: KnowledgeAsset[] = [];
  const notes: KnowledgeNote[] = [];
  const fields: [AssetKind, string, string][] = [
    ["rule", "rules.txt", String(form.get("knowledgeText") ?? "")],
    ["checklist", "checklist.txt", String(form.get("checklistText") ?? "")],
    ["template", "template.txt", String(form.get("templateText") ?? "")],
    ["example", "example.txt", String(form.get("exampleAssetText") ?? "")],
  ];
  for (const [kind, name, text] of fields) {
    if (text.length > 60_000) return { notes, assets, interview: [], error: "knowledge" };
    const made = asset(kind, name, text);
    if (made) {
      assets.push(made);
      notes.push({ name: made.name, text: made.text });
    }
  }
  const file = form.get("knowledgeFile");
  const requested = String(form.get("assetKind") ?? "rule");
  const fileKind = KINDS.has(requested as AssetKind) ? (requested as AssetKind) : "rule";
  if (file instanceof File && file.size > 0) {
    if (file.size > 100_000) return { notes: [], assets: [], interview: [], error: "knowledge" };
    const body = await file.text();
    const accepted = acceptKnowledgeFile(file.name, file.size, body);
    if (!accepted.ok) return { notes: [], assets: [], interview: [], error: "knowledge" };
    const made = asset(fileKind, accepted.name, accepted.text);
    if (!made) return { notes, assets, interview: [], error: "knowledge" };
    assets.push(made);
    notes.push({ name: made.name, text: made.text });
  }
  const interview: InterviewAnswer[] = INTERVIEW.map((item) => ({
    questionId: item.id,
    answer: String(form.get(`interview_${item.id}`) ?? ""),
  }));
  return { notes, assets, interview };
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
  const sla = Number(form.get("slaHours") ?? "48");
  const reviewPrice = String(form.get("reviewPrice") ?? "").trim();
  const input: AgentInput = {
    name: String(form.get("name") ?? ""),
    pitch: String(form.get("pitch") ?? ""),
    description: String(form.get("description") ?? ""),
    category: String(form.get("category") ?? ""),
    instructions: String(form.get("instructions") ?? ""),
    knowledge: knowledge.notes,
    assets: knowledge.assets,
    interview: knowledge.interview,
    trainingConsent: form.get("trainingConsent") === "yes",
    expertReview: {
      enabled: form.get("expertReview") === "yes",
      priceMinor: reviewPrice ? Math.round(Number(reviewPrice) * 100) : 0,
      slaHours: sla === 24 || sla === 72 ? sla : 48,
    },
    exampleTitle: String(form.get("exampleTitle") ?? ""),
    exampleBody: String(form.get("exampleBody") ?? ""),
    priceRaw: String(form.get("price") ?? ""),
  };
  const saved = await saveAgent(user.id, input, intent, slug || undefined);
  if (!saved.ok) {
    return redirectTo(request, back, { error: saved.error, skill });
  }
  if (saved.proofQueued) {
    after(() => {
      scheduleProof(saved.slug);
    });
  }
  const next = intent === "publish" ? `/${locale}/listings/${saved.slug}` : `/${locale}/sell/${saved.slug}`;
  return redirectTo(request, next);
}
