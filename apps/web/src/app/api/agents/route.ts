import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { canSell } from "@/lib/accounts";
import { isListingSlug, saveAgent, type AgentInput } from "@/lib/marketplace";
import type { AssetKind, InterviewAnswer, KnowledgeAsset, KnowledgeNote } from "@/lib/demo-store";
import { scheduleProof } from "@/lib/proof";
import { INTERVIEW } from "@/lib/trust";
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
    const body = (await file.text()).replace(/\u0000/g, "");
    const name = file.name.replace(/[^\w.\- ]+/g, "").slice(0, 80) || "upload.txt";
    const made = asset(fileKind, name, body);
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
  if (slug && !isListingSlug(slug)) {
    return redirectTo(request, `/${locale}/sell`, { error: "missing" });
  }
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
    return redirectTo(request, back, { error: saved.error });
  }
  if (saved.proofQueued) {
    after(() => {
      scheduleProof(saved.slug);
    });
  }
  const next = intent === "publish" ? `/${locale}/listings/${saved.slug}` : `/${locale}/sell/${saved.slug}`;
  return redirectTo(request, next);
}
