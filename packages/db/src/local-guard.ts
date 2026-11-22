const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function assertLocalDatabaseHost(hostname: string): void {
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error("seed-local refuses non-local databases");
  }
}
