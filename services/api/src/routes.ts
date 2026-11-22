export type Routed = "health" | "demo" | "missing";

export function demoEnabled(env: string | undefined): boolean {
  const name = env && env.length > 0 ? env : "local";
  return name === "local" || name === "dev";
}

export function route(
  method: string | undefined,
  url: string | undefined,
  env: string | undefined,
): Routed {
  const path = url?.split("?")[0];
  if (path === "/health") {
    return "health";
  }
  if (method === "POST" && path === "/v1/demo/hospital-beds" && demoEnabled(env)) {
    return "demo";
  }
  return "missing";
}
