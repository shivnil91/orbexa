export type Health = {
  service: "orbexa-api";
  status: "ok" | "degraded";
  database?: "ok" | "down";
};

export function healthBody(): Health {
  return { service: "orbexa-api", status: "ok" };
}

export async function healthReport(
  env: NodeJS.ProcessEnv,
  ping: () => Promise<boolean>,
): Promise<{ status: number; body: Health }> {
  if (!env.DB_HOST && env.ORBEXA_STORE !== "postgres") {
    return { status: 200, body: healthBody() };
  }
  const up = await ping();
  if (!up) return { status: 503, body: { service: "orbexa-api", status: "degraded", database: "down" } };
  return { status: 200, body: { service: "orbexa-api", status: "ok", database: "ok" } };
}
