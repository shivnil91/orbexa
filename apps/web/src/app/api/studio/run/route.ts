import { CSV_MAX_BYTES, decodeCsvBytes } from "@/lib/studio-calc";
import { completeRun, requestBroker, saveRunAnswers, saveShare, startRun } from "@/lib/studio-store";
import { formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = formLocale(form);
  const intent = String(form.get("intent") ?? "");
  if (intent === "share") {
    const token = String(form.get("token") ?? "");
    const answers: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (key.startsWith("answer_")) answers[key.slice("answer_".length)] = String(value);
    }
    const saved = await saveShare(token, answers);
    if (!saved.ok) return redirectTo(request, `/${locale}`, { error: saved.error });
    return redirectTo(request, `/${locale}/share/${token}`);
  }
  const user = await currentUser();
  if (!user) return redirectTo(request, `/${locale}/sign-in`, { next: `/${locale}/listings` });
  if (intent === "start") {
    const slug = String(form.get("slug") ?? "");
    const started = await startRun(user.id, slug, String(form.get("tier") ?? "autonomous"));
    if (!started.ok) return redirectTo(request, `/${locale}/listings/${slug}`, { error: started.error });
    return redirectTo(request, `/${locale}/listings/${slug}/work/${started.run.id}`);
  }
  const runId = String(form.get("runId") ?? "");
  const slug = String(form.get("slug") ?? "");
  const back = `/${locale}/listings/${slug}/work/${runId}`;
  if (intent === "answers") {
    const answers: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (key.startsWith("answer_")) answers[key.slice("answer_".length)] = String(value);
    }
    const saved = await saveRunAnswers(user.id, runId, answers);
    if (!saved.ok) return redirectTo(request, back, { error: saved.error });
    return redirectTo(request, back);
  }
  if (intent === "complete") {
    const file = form.get("csv");
    let name = "";
    let bytes = 0;
    let text = "";
    if (file instanceof File && file.size > 0) {
      if (!Number.isSafeInteger(file.size) || file.size >= CSV_MAX_BYTES) return redirectTo(request, back, { error: "csv" });
      name = file.name;
      const raw = new Uint8Array(await file.arrayBuffer());
      const accepted = decodeCsvBytes(name, raw);
      if (!accepted.ok) return redirectTo(request, back, { error: "csv" });
      text = accepted.text;
      bytes = raw.byteLength;
    }
    const saved = await completeRun(user.id, runId, name || "upload.csv", bytes, text);
    if (!saved.ok) return redirectTo(request, back, { error: saved.error });
    return redirectTo(request, back);
  }
  if (intent === "broker") {
    const saved = await requestBroker(user.id, runId);
    if (!saved.ok) return redirectTo(request, back, { error: saved.error });
    return redirectTo(request, back);
  }
  return redirectTo(request, back, { error: "generic" });
}
