import { canSell, updateConnect } from "@/lib/accounts";
import { beginConnectOnboarding, syncConnectAccount } from "@/lib/connect";
import { stripeTestTransport } from "@/lib/payments";
import { appUrl, formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = formLocale(form);
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
      expectedOrigin: origin,
    });
    if (result.accountId && /^acct_[A-Za-z0-9]+$/.test(result.accountId)) {
      const synced = await syncConnectAccount({
        user: { ...user, connect: { mode: result.mode, accountId: result.accountId, chargesEnabled: false, detailsSubmitted: false } },
        transport: stripeTestTransport,
      });
      await updateConnect(user.id, synced);
    }
    if (result.url?.startsWith("https://connect.stripe.com/")) {
      return NextResponse.redirect(result.url, 303);
    }
    return redirectTo(request, `/${locale}/sell/dashboard`, { notice: result.error ?? "simulated", error: result.error });
  } catch (error) {
    const live = error instanceof Error && /live Stripe/.test(error.message);
    return redirectTo(request, `/${locale}/sell/dashboard`, { error: live ? "live" : "stripe" });
  }
}
