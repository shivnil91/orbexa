import { canSell, updateConnect } from "@/lib/accounts";
import { beginConnectOnboarding } from "@/lib/connect";
import { stripeTestTransport } from "@/lib/payments";
import { appUrl, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  const user = await currentUser();
  if (!user || !canSell(user.role)) {
    return redirectTo(request, `/${locale}/sell`, { error: "forbidden" });
  }
  const origin = appUrl(request, "/").origin;
  try {
    const result = await beginConnectOnboarding({
      user,
      transport: stripeTestTransport,
      returnUrl: `${origin}/${locale}/sell/dashboard`,
      refreshUrl: `${origin}/${locale}/sell/dashboard`,
    });
    if (result.accountId) {
      await updateConnect(user.id, {
        mode: result.mode,
        accountId: result.accountId,
        chargesEnabled: result.chargesEnabled,
        detailsSubmitted: result.detailsSubmitted,
      });
    }
    if (result.url) {
      return NextResponse.redirect(result.url, 303);
    }
    return redirectTo(request, `/${locale}/sell/dashboard`, { notice: result.error ?? "simulated", error: result.error });
  } catch (error) {
    const live = error instanceof Error && /live Stripe/.test(error.message);
    return redirectTo(request, `/${locale}/sell/dashboard`, { error: live ? "live" : "stripe" });
  }
}
