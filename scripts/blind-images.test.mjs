import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { deflateSync } from "node:zlib";
import {
  encodeRgbPng,
  loadPersonaImages,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  personaImageNames,
  pngForModel,
  readRgbPng,
} from "./blind-images.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("persona screenshots are capped at three and cannot include another persona", () => {
  const names = [
    "persona-andre-draft.png",
    "persona-andre-earn.png",
    "persona-andre-live.png",
    "persona-andre-extra.png",
    "../persona-andre-secret.png",
    "persona-andrea-draft.png",
    "persona-luis-draft.png",
    "landing-mobile.png",
  ];
  assert.deepEqual(personaImageNames(names, "andre"), [
    "persona-andre-draft.png",
    "persona-andre-earn.png",
    "persona-andre-extra.png",
  ]);
  assert.deepEqual(personaImageNames(names, "../andre"), []);
});

test("a png round-trips and an image at 8000px is reduced under the model limit", () => {
  const pixels = Buffer.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 11, 22, 33]);
  const encoded = encodeRgbPng({ width: 2, height: 2, channels: 3, pixels });
  const decoded = readRgbPng(encoded);
  assert.deepEqual(decoded.pixels, pixels);
  const fitted = pngForModel(encoded);
  assert.equal(fitted.width, 2);
  assert.equal(fitted.height, 2);
  assert.equal(Buffer.from(fitted.data, "base64").equals(encoded), true);

  const tallPixels = Buffer.alloc(1 * 8000 * 3, 40);
  const tall = encodeRgbPng({ width: 1, height: 8000, channels: 3, pixels: tallPixels });
  const reduced = pngForModel(tall);
  assert.ok(reduced.width < MAX_IMAGE_EDGE);
  assert.ok(reduced.height < MAX_IMAGE_EDGE);
  assert.ok(reduced.bytes < MAX_IMAGE_BYTES);
  const again = readRgbPng(Buffer.from(reduced.data, "base64"));
  assert.equal(again.height, reduced.height);
  assert.equal(again.pixels[0], 40);
});

test("a sub filter decodes to the original pixels", () => {
  const width = 2;
  const height = 1;
  const channels = 3;
  const raw = Buffer.from([1, 10, 20, 30, 30, 30, 30]);
  const png = wrapFiltered(width, height, channels, raw);
  const decoded = readRgbPng(png);
  assert.deepEqual([...decoded.pixels], [10, 20, 30, 40, 50, 60]);
});

test("an image over the byte cap is scaled down", () => {
  const pixels = Buffer.alloc(80 * 80 * 3);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = (index * 17) & 255;
  }
  const encoded = encodeRgbPng({ width: 80, height: 80, channels: 3, pixels });
  const reduced = pngForModel(encoded, { maxEdge: 8000, maxBytes: encoded.length });
  assert.ok(reduced.bytes < encoded.length);
  assert.ok(reduced.width < 80 || reduced.height < 80);
  assert.equal(reduced.mediaType, "image/png");
});

test("round-4 persona screenshots fit three images under 5MB and 8000px", async () => {
  const directory = path.join(root, "docs/gtm/round-4");
  const names = await readdir(directory);
  for (const persona of ["andre", "luis", "helen", "maya", "derek", "priya"]) {
    const selected = personaImageNames(names, persona);
    assert.equal(selected.length, 3, persona);
    const images = await loadPersonaImages(directory, persona);
    assert.equal(images.length, 3);
    for (const image of images) {
      assert.ok(image.width < MAX_IMAGE_EDGE, persona);
      assert.ok(image.height < MAX_IMAGE_EDGE, persona);
      assert.ok(image.bytes < MAX_IMAGE_BYTES, persona);
      assert.equal(image.mediaType, "image/png");
    }
  }
  const andre = await readFile(path.join(directory, "persona-andre-draft.png"));
  const fitted = pngForModel(andre);
  assert.ok(fitted.height < 8000);
  assert.ok(fitted.height < readRgbPng(andre).height);
});

test("loadPersonaImages reads only the capped files from a directory", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-blind-"));
  try {
    const pixels = Buffer.alloc(2 * 8100 * 3, 9);
    const tall = encodeRgbPng({ width: 2, height: 8100, channels: 3, pixels });
    await writeFile(path.join(directory, "persona-andre-a.png"), tall);
    await writeFile(path.join(directory, "persona-andre-b.png"), tall);
    await writeFile(path.join(directory, "persona-andre-c.png"), tall);
    await writeFile(path.join(directory, "persona-andre-d.png"), tall);
    await writeFile(path.join(directory, "persona-luis-a.png"), tall);
    const images = await loadPersonaImages(directory, "andre");
    assert.equal(images.length, 3);
    for (const image of images) {
      assert.ok(image.height < 8000);
      assert.ok(image.bytes < MAX_IMAGE_BYTES);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function wrapFiltered(width, height, channels, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  const compressed = deflateSync(raw);
  const crc = crc32;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    piece("IHDR", ihdr, crc),
    piece("IDAT", compressed, crc),
    piece("IEND", Buffer.alloc(0), crc),
  ]);
}

function piece(type, data, crc) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body), 0);
  return Buffer.concat([length, body, sum]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}
