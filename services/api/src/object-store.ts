import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..", ".local-object-store");

export type StoredObject = {
  key: string;
  sha256: string;
  byteSize: number;
};

export function putObject(key: string, bytes: Buffer): StoredObject {
  const file = objectPath(key);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return {
    key,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.length,
  };
}

export function readObject(key: string): Buffer {
  return readFileSync(objectPath(key));
}

function objectPath(key: string): string {
  if (key.length === 0 || key.includes("..") || path.isAbsolute(key)) {
    throw new Error("invalid storage key");
  }
  return path.join(root, key);
}
