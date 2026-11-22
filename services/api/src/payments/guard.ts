const LIVE_MARKERS = ["sk_live_", "rk_live_"];

export class LiveStripeKeyError extends Error {
  constructor(variable: string) {
    super(`refusing to start: ${variable} contains a live Stripe secret`);
    this.name = "LiveStripeKeyError";
  }
}

export function assertNoLiveStripeKey(env: NodeJS.ProcessEnv): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && LIVE_MARKERS.some((marker) => value.includes(marker))) {
      throw new LiveStripeKeyError(key);
    }
  }
}
