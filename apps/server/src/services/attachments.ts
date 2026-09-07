import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type SniffedImageType = 'png' | 'jpeg' | 'webp' | 'gif';

export interface SniffedImage {
  type: SniffedImageType;
  mimeType: string;
  extension: string;
  width: number | null;
  height: number | null;
}

const MAGIC = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
} as const;

function startsWith(buffer: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function ascii(buffer: Buffer, offset: number, length: number): string {
  return buffer.subarray(offset, offset + length).toString('latin1');
}

function u16be(buffer: Buffer, offset: number): number {
  return buffer.readUInt16BE(offset);
}

function u16le(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function plausibleDimensions(
  width: number,
  height: number,
): { width: number; height: number } | null {
  if (width <= 0 || height <= 0 || width > 100_000 || height > 100_000) return null;
  return { width, height };
}

/**
 * Sniffs an uploaded buffer's image type via magic bytes (plan §2.5: MIME
 * sniff, never trust the declared content type) and best-effort extracts
 * pixel dimensions. Returns null when the buffer is not a supported image.
 */
export function sniffImage(buffer: Buffer): SniffedImage | null {
  // PNG — IHDR width/height are fixed-offset big-endian uint32.
  if (startsWith(buffer, MAGIC.png) && buffer.length >= 24) {
    const dims = plausibleDimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
    return {
      type: 'png',
      mimeType: 'image/png',
      extension: 'png',
      width: dims?.width ?? null,
      height: dims?.height ?? null,
    };
  }

  // JPEG — scan segment markers for the first SOFn frame header.
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    const dims = jpegDimensions(buffer);
    return {
      type: 'jpeg',
      mimeType: 'image/jpeg',
      extension: 'jpg',
      width: dims?.width ?? null,
      height: dims?.height ?? null,
    };
  }

  // GIF — logical screen descriptor directly after the header.
  if (
    buffer.length >= 10 &&
    (ascii(buffer, 0, 6) === 'GIF87a' || ascii(buffer, 0, 6) === 'GIF89a')
  ) {
    const dims = plausibleDimensions(u16le(buffer, 6), u16le(buffer, 8));
    return {
      type: 'gif',
      mimeType: 'image/gif',
      extension: 'gif',
      width: dims?.width ?? null,
      height: dims?.height ?? null,
    };
  }

  // WEBP — RIFF container; dimensions depend on the VP8 chunk flavor.
  if (buffer.length >= 30 && ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'WEBP') {
    const dims = webpDimensions(buffer);
    return {
      type: 'webp',
      mimeType: 'image/webp',
      extension: 'webp',
      width: dims?.width ?? null,
      height: dims?.height ?? null,
    };
  }

  return null;
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    const markerByte = buffer.readUInt8(offset);
    if (markerByte !== 0xff) return null;
    const marker = buffer.readUInt8(offset + 1);
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = u16be(buffer, offset + 2);
    // SOF0–SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const dims = plausibleDimensions(u16be(buffer, offset + 7), u16be(buffer, offset + 5));
      return dims ?? null;
    }
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(buffer: Buffer): { width: number; height: number } | null {
  const chunk = ascii(buffer, 12, 4);
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    return plausibleDimensions(u16le(buffer, 26) & 0x3fff, u16le(buffer, 28) & 0x3fff);
  }
  if (chunk === 'VP8L' && buffer.length >= 25 && buffer.readUInt8(20) === 0x2f) {
    // VP8L lossless: 14 bits width-1, then 14 bits height-1 (LSB-first).
    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return plausibleDimensions(width, height);
  }
  if (chunk === 'VP8X' && buffer.length >= 30) {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return plausibleDimensions(width, height);
  }
  return null;
}

export interface StoredImage {
  filePath: string; // relative to the data dir (attachments.filePath)
  url: string; // /media/... served by @fastify/static
  absolutePath: string;
  sniffed: SniffedImage;
  sizeBytes: number;
}

/**
 * Writes a validated image buffer to `data/media/<uuid>.<ext>` (plan D5:
 * bytes on disk, metadata in SQLite) and returns its stored coordinates.
 */
export function storeImage(dataDir: string, buffer: Buffer, sniffed: SniffedImage): StoredImage {
  const mediaDir = path.join(dataDir, 'media');
  mkdirSync(mediaDir, { recursive: true });
  const fileName = `${randomUUID()}.${sniffed.extension}`;
  const absolutePath = path.join(mediaDir, fileName);
  writeFileSync(absolutePath, buffer);
  return {
    filePath: `media/${fileName}`,
    url: `/media/${fileName}`,
    absolutePath,
    sniffed,
    sizeBytes: buffer.length,
  };
}
