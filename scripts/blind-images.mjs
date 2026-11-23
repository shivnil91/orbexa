import { deflateSync, inflateSync } from "node:zlib";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const MAX_IMAGES_PER_CALL = 3;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 8000;
const MAX_SOURCE_PIXELS = 40_000_000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function personaImageNames(names, personaId) {
  if (!/^[a-z0-9-]+$/.test(personaId)) {
    return [];
  }
  const prefix = `persona-${personaId}-`;
  return names
    .filter((name) => name.startsWith(prefix) && name.endsWith(".png") && path.basename(name) === name)
    .sort()
    .slice(0, MAX_IMAGES_PER_CALL);
}

export function pngForModel(input, limits = {}) {
  const maxEdge = limits.maxEdge ?? MAX_IMAGE_EDGE;
  const maxBytes = limits.maxBytes ?? MAX_IMAGE_BYTES;
  const source = Buffer.from(input);
  const header = readIhdr(source);
  if (header.width < maxEdge && header.height < maxEdge && source.length < maxBytes) {
    return imageResult(source, header.width, header.height);
  }
  if (header.bitDepth !== 8 || (header.colorType !== 2 && header.colorType !== 6) || header.interlace !== 0) {
    throw new Error("image is over the model limit and cannot be resized");
  }
  const image = readRgbPng(source);
  const longest = Math.max(image.width, image.height);
  let scale = longest >= maxEdge ? (maxEdge - 1) / longest : 1;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const width = Math.max(1, Math.floor(image.width * scale));
    const height = Math.max(1, Math.floor(image.height * scale));
    const scaled = width === image.width && height === image.height ? image : scaleImage(image, width, height);
    const encoded = encodeRgbPng(scaled);
    if (encoded.length < maxBytes && width < maxEdge && height < maxEdge) {
      return imageResult(encoded, width, height);
    }
    scale *= 0.7;
  }
  throw new Error("image could not be reduced under the model limits");
}

export async function loadPersonaImages(directory, personaId) {
  const names = await readdir(directory).catch(() => []);
  const selected = personaImageNames(names, personaId);
  const images = [];
  for (const name of selected) {
    const bytes = await readFile(path.join(directory, name));
    images.push(pngForModel(bytes));
  }
  return images;
}

export function encodeRgbPng(image) {
  const stride = image.width * image.channels;
  const raw = Buffer.alloc(image.height * (stride + 1));
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    image.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return wrapPng(image.width, image.height, image.channels, deflateSync(raw));
}

export function readRgbPng(buffer) {
  const source = Buffer.from(buffer);
  const header = readIhdr(source);
  if (header.bitDepth !== 8 || (header.colorType !== 2 && header.colorType !== 6) || header.interlace !== 0) {
    throw new Error("unsupported png");
  }
  if (header.width < 1 || header.height < 1 || header.width * header.height > MAX_SOURCE_PIXELS) {
    throw new Error("image is too large to resize");
  }
  const channels = header.colorType === 2 ? 3 : 4;
  const stride = header.width * channels;
  const inflated = inflateSync(Buffer.concat(readChunks(source).idat));
  if (inflated.length !== header.height * (stride + 1)) {
    throw new Error("png size does not match the header");
  }
  const pixels = Buffer.alloc(header.height * stride);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < header.height; y += 1) {
    const start = y * (stride + 1);
    const filter = inflated[start];
    const row = Buffer.from(inflated.subarray(start + 1, start + 1 + stride));
    unfilter(filter, row, previous, channels);
    row.copy(pixels, y * stride);
    previous = row;
  }
  return { width: header.width, height: header.height, channels, pixels };
}

function imageResult(bytes, width, height) {
  return {
    mediaType: "image/png",
    data: bytes.toString("base64"),
    width,
    height,
    bytes: bytes.length,
  };
}

function scaleImage(image, width, height) {
  const dest = Buffer.alloc(width * height * image.channels);
  for (let y = 0; y < height; y += 1) {
    const yStart = Math.floor((y * image.height) / height);
    const yEnd = Math.max(yStart + 1, Math.floor(((y + 1) * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const xStart = Math.floor((x * image.width) / width);
      const xEnd = Math.max(xStart + 1, Math.floor(((x + 1) * image.width) / width));
      for (let channel = 0; channel < image.channels; channel += 1) {
        let sum = 0;
        let count = 0;
        for (let sy = yStart; sy < yEnd; sy += 1) {
          for (let sx = xStart; sx < xEnd; sx += 1) {
            sum += image.pixels[(sy * image.width + sx) * image.channels + channel];
            count += 1;
          }
        }
        dest[(y * width + x) * image.channels + channel] = Math.round(sum / count);
      }
    }
  }
  return { width, height, channels: image.channels, pixels: dest };
}

function readIhdr(buffer) {
  if (buffer.length < 29 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a png");
  }
  const chunks = readChunks(buffer);
  return chunks.header;
}

function readChunks(buffer) {
  let offset = 8;
  const idat = [];
  let header = null;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) {
      throw new Error("truncated png");
    }
    const data = buffer.subarray(dataStart, dataEnd);
    const expected = buffer.readUInt32BE(dataEnd);
    const actual = crc32(Buffer.concat([Buffer.from(type), data]));
    if (expected !== actual) {
      throw new Error("png crc mismatch");
    }
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!header) {
    throw new Error("png has no header");
  }
  return { header, idat };
}

function wrapPng(width, height, channels, compressed) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
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

function unfilter(filter, row, previous, channels) {
  if (filter === 0) {
    return;
  }
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= channels ? row[index - channels] : 0;
    const up = previous[index];
    const upLeft = index >= channels ? previous[index - channels] : 0;
    if (filter === 1) {
      row[index] = (row[index] + left) & 255;
    } else if (filter === 2) {
      row[index] = (row[index] + up) & 255;
    } else if (filter === 3) {
      row[index] = (row[index] + Math.floor((left + up) / 2)) & 255;
    } else if (filter === 4) {
      row[index] = (row[index] + paeth(left, up, upLeft)) & 255;
    } else {
      throw new Error("unsupported png filter");
    }
  }
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  if (upDistance <= upLeftDistance) {
    return up;
  }
  return upLeft;
}
