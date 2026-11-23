export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { seedExamples } = await import("./lib/seed.ts");
  const { logEvent } = await import("./lib/log.ts");
  try {
    await seedExamples();
  } catch {
    logEvent({ event: "seed_failed" });
  }
}
