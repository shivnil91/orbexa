import { NextResponse } from "next/server";
import { applyVerifiedStripePayment, applyVerifiedStripeRefund } from "@/lib/jobs";
import { verifyStripeTestWebhook } from "@/lib/payments";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  try {
    const event = verifyStripeTestWebhook(body, signature, process.env);
    if (event.type === "refund.succeeded") {
      await applyVerifiedStripeRefund(event);
      return NextResponse.json({ received: true, applied: true });
    }
    if (event.type !== "payment.captured") {
      return NextResponse.json({ received: true, applied: false });
    }
    await applyVerifiedStripePayment(event);
    return NextResponse.json({ received: true, applied: true });
  } catch {
    return NextResponse.json({ error: "webhook" }, { status: 400 });
  }
}
