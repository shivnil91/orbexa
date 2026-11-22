import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function assertKey(key: string): void {
  if (key.length === 0 || key.includes("..") || path.isAbsolute(key)) {
    throw new Error("invalid storage key");
  }
}

export class VersionedObjectStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  put(key: string, bytes: Buffer): { versionId: string; sha256: string } {
    assertKey(key);
    const versionId = randomUUID();
    const dir = path.join(this.root, key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, versionId), bytes);
    writeFileSync(path.join(dir, "current"), versionId);
    return {
      versionId,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  get(key: string, versionId?: string): Buffer {
    assertKey(key);
    const dir = path.join(this.root, key);
    const id = versionId ?? readFileSync(path.join(dir, "current"), "utf8");
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new Error("invalid version");
    }
    return readFileSync(path.join(dir, id));
  }

  redactAllVersions(key: string): void {
    assertKey(key);
    const dir = path.join(this.root, key);
    const marker = Buffer.from("[redacted]");
    for (const name of readdirSync(dir)) {
      if (name === "current") {
        continue;
      }
      writeFileSync(path.join(dir, name), marker);
    }
  }
}

export type RestoreDrillRecord = {
  source: "versioned-object-store";
  method: "versioned-object-get";
  aws_rds_snapshot_restore: false;
  aws_s3_get_object_version: false;
  elapsed_ms: number;
  body_matches: boolean;
  bytes_read: number;
};

export function restorePriorVersion(
  store: VersionedObjectStore,
  key: string,
  versionId: string,
  expected: Buffer,
): RestoreDrillRecord {
  const started = performance.now();
  const bytes = store.get(key, versionId);
  const elapsed = performance.now() - started;
  return {
    source: "versioned-object-store",
    method: "versioned-object-get",
    aws_rds_snapshot_restore: false,
    aws_s3_get_object_version: false,
    elapsed_ms: elapsed,
    body_matches: bytes.equals(expected),
    bytes_read: bytes.length,
  };
}
