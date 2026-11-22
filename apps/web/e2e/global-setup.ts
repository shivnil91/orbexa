import { mkdir, rm } from "node:fs/promises";

export default async function globalSetup(): Promise<void> {
  await rm("/tmp/orbexa-e2e", { recursive: true, force: true });
  await mkdir("/opt/cursor/artifacts", { recursive: true });
}
