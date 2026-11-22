const LIVE_MARKERS = ["sk_live_", "rk_live_"];

export function assertNoLiveStripeKey(env: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && LIVE_MARKERS.some((marker) => value.includes(marker))) {
      throw new Error(`refusing to start: ${key} contains a live Stripe secret`);
    }
  }
}
