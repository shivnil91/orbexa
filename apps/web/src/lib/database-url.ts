const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

/**
 * Build the Postgres URL the dev task does not inject.
 * The password is URL-encoded. The query always sets sslmode=require.
 */
export function databaseUrlFromEnv(env: Record<string, string | undefined>): string {
  const host = required(env, "DB_HOST");
  const port = env.DB_PORT && env.DB_PORT.length > 0 ? env.DB_PORT : "5432";
  const name = required(env, "DB_NAME");
  const user = required(env, "DB_USER");
  const password = required(env, "DB_PASSWORD");
  const sslmode = env.DB_SSLMODE && env.DB_SSLMODE.length > 0 ? env.DB_SSLMODE : "require";
  if (sslmode !== "require") {
    throw new Error("DB_SSLMODE must be require");
  }
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) {
    throw new Error("DB_PORT is invalid");
  }
  if (!HOST.test(host)) {
    throw new Error("DB_HOST is invalid");
  }
  // uselibpqcompat keeps node-pg on libpq's meaning of sslmode=require:
  // encrypt the session, and do not require a CA bundle. Without it, current
  // node-pg treats require as verify-full.
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}?sslmode=require&uselibpqcompat=true`;
}
