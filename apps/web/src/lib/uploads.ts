import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { marketplaceDir } from "./demo-store.ts";
import type { UploadRecord } from "./repository.ts";

const ID = /^[A-Za-z0-9_-]{1,80}$/;

export function uploadsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DOCUMENT_BUCKET || env.UPLOAD_SIGNING_KEY);
}

export function uploadObjectKey(sellerId: string, id: string = randomUUID()): string {
  if (!ID.test(sellerId) || !ID.test(id)) {
    throw new Error("upload key is invalid");
  }
  return `sellers/${sellerId}/uploads/${id}`;
}

export function putObjectInput(bucket: string, key: string, contentType: string): {
  Bucket: string;
  Key: string;
  ContentType: string;
  ServerSideEncryption: "AES256";
} {
  if (!key.startsWith("sellers/") || key.includes("..") || key.startsWith("/")) {
    throw new Error("upload key is invalid");
  }
  return { Bucket: bucket, Key: key, ContentType: contentType, ServerSideEncryption: "AES256" };
}

export function presignLocal(key: string, secret: string, expiresAt: number): string {
  if (!secret) throw new Error("UPLOAD_SIGNING_KEY is required");
  const sig = createHmac("sha256", secret).update(`${key}.${expiresAt}`).digest("hex");
  return `/api/uploads?key=${encodeURIComponent(key)}&exp=${expiresAt}&sig=${sig}`;
}

export function localSignatureMatches(key: string, exp: string, sig: string, secret: string, now = Date.now()): boolean {
  if (!secret || !/^\d+$/.test(exp) || !/^[a-f0-9]{64}$/.test(sig)) return false;
  const expiresAt = Number(exp);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now) return false;
  const expected = createHmac("sha256", secret).update(`${key}.${expiresAt}`).digest("hex");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function uploadDir(): string {
  return process.env.ORBEXA_UPLOAD_DIR ?? path.join(marketplaceDir(), "uploads");
}

export async function writeLocalObject(key: string, bytes: Buffer): Promise<void> {
  const file = path.join(uploadDir(), key);
  if (!file.startsWith(path.join(uploadDir(), "sellers") + path.sep)) {
    throw new Error("upload key is invalid");
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

export async function readLocalObject(key: string): Promise<Buffer | null> {
  const file = path.join(uploadDir(), key);
  if (!file.startsWith(path.join(uploadDir(), "sellers") + path.sep)) return null;
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function presignGet(key: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (env.DOCUMENT_BUCKET) {
    const { GetObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const client = new S3Client({ region: env.AWS_REGION || "ap-southeast-2" });
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: env.DOCUMENT_BUCKET, Key: key }), { expiresIn: 300 });
    if (!url.includes("X-Amz-Signature") && !url.includes("X-Amz-Algorithm")) {
      throw new Error("refusing an unsigned object url");
    }
    return url;
  }
  const secret = env.UPLOAD_SIGNING_KEY ?? "";
  return presignLocal(key, secret, Date.now() + 7 * 24 * 60 * 60 * 1000);
}

export async function putSellerUpload(input: {
  sellerId: string;
  clientId?: string | null;
  bytes: Buffer;
  contentType: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<UploadRecord> {
  const id = randomUUID();
  const objectKey = uploadObjectKey(input.sellerId, id);
  if (env.DOCUMENT_BUCKET) {
    const { PutObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
    const client = new S3Client({ region: env.AWS_REGION || "ap-southeast-2" });
    const command = putObjectInput(env.DOCUMENT_BUCKET, objectKey, input.contentType);
    await client.send(new PutObjectCommand({ ...command, Body: input.bytes }));
  } else {
    await writeLocalObject(objectKey, input.bytes);
  }
  const row: UploadRecord = {
    id,
    sellerId: input.sellerId,
    clientId: input.clientId ?? null,
    objectKey,
    contentType: input.contentType,
    byteSize: input.bytes.byteLength,
    createdAt: new Date().toISOString(),
  };
  const { getMarket } = await import("./repository.ts");
  await getMarket().writeUpload(row);
  return row;
}
