import { releaseExpertReview, saveExpertDraft } from "@/lib/jobs";
import { formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const form = await request.formData();
  const locale = formLocale(form);
  const user = await currentUser();
  if (!user) {
    return redirectTo(request, `/${locale}/sign-in`, { next: `/${locale}/sell/queue/${id}` });
  }
  const intent = String(form.get("intent") ?? "save");
  try {
    if (intent === "release") {
      await releaseExpertReview(id, user.id);
    } else {
      await saveExpertDraft(id, user.id, String(form.get("draft") ?? ""));
    }
  } catch {
    return redirectTo(request, `/${locale}/sell/queue/${id}`, { error: "forbidden" });
  }
  return redirectTo(request, `/${locale}/sell/queue/${id}`, { saved: "1" });
}
