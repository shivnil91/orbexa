import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { localSignatureMatches, presignLocal, putObjectInput, uploadObjectKey, writeLocalObject, readLocalObject } from "./uploads.ts";

test("upload keys stay under the seller prefix and objects are not public", () => {
  const key = uploadObjectKey("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "file-1");
  assert.equal(key, "sellers/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/uploads/file-1");
  assert.throws(() => uploadObjectKey("../x", "file-1"));
  const input = putObjectInput("orbexa-dev-documents", key, "text/plain");
  assert.equal(input.ServerSideEncryption, "AES256");
  assert.equal("ACL" in input, false);
  assert.equal(JSON.stringify(input).includes("public-read"), false);
  const url = presignLocal(key, "signing-secret", 1_900_000_000_000);
  assert.equal(url.startsWith("/api/uploads?"), true);
  assert.equal(url.includes("public"), false);
  const exp = "1900000000000";
  const sig = new URL(url, "http://local").searchParams.get("sig") ?? "";
  assert.equal(localSignatureMatches(key, exp, sig, "signing-secret", 1_700_000_000_000), true);
  assert.equal(localSignatureMatches(key, exp, sig, "other-secret", 1_700_000_000_000), false);
});

test("local upload bytes are private to the signed key", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-upload-"));
  const previous = process.env.ORBEXA_UPLOAD_DIR;
  process.env.ORBEXA_UPLOAD_DIR = directory;
  try {
    const key = uploadObjectKey("seller-1", "doc-1");
    await writeLocalObject(key, Buffer.from("wages"));
    assert.equal((await readLocalObject(key))?.toString(), "wages");
    assert.equal(await readLocalObject("sellers/seller-1/../secret"), null);
  } finally {
    if (previous === undefined) delete process.env.ORBEXA_UPLOAD_DIR;
    else process.env.ORBEXA_UPLOAD_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
