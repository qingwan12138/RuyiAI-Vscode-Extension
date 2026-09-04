// Pure-JS PNG encoder + RGB downscaler for scanned PDF pages (no native deps).
//
// pdf.js hands us decoded raster data (RGB24 / RGBA32 / Gray8) for embedded
// scanned pages; we resize pages above the vision pixel budget and write a
// minimal PNG (zlib deflate from Node's built-in `zlib`). Dependency-free apart
// from node builtins, so it works in the extension host.

import { deflateSync } from 'node:zlib';

export interface RasterImage {
  data: Uint8Array;
  width: number;
  height: number;
  /** 1 = gray8, 3 = RGB, 4 = RGBA */
  channels: 1 | 3 | 4;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Nearest-neighbor downscale that only ever shrinks (keeps aspect ratio). */
export function downscaleRaster(image: RasterImage, maxPixels: number): RasterImage {
  const { width, height, data, channels } = image;
  if (width * height <= maxPixels) return image;
  const scale = Math.sqrt(maxPixels / (width * height));
  const outWidth = Math.max(1, Math.floor(width * scale));
  const outHeight = Math.max(1, Math.floor(height * scale));
  const out = new Uint8Array(outWidth * outHeight * channels);
  for (let y = 0; y < outHeight; y += 1) {
    const srcY = Math.min(height - 1, Math.floor((y + 0.5) * height / outHeight));
    for (let x = 0; x < outWidth; x += 1) {
      const srcX = Math.min(width - 1, Math.floor((x + 0.5) * width / outWidth));
      const srcIndex = (srcY * width + srcX) * channels;
      const dstIndex = (y * outWidth + x) * channels;
      for (let c = 0; c < channels; c += 1) {
        out[dstIndex + c] = data[srcIndex + c];
      }
    }
  }
  return { data: out, width: outWidth, height: outHeight, channels };
}

/** Encode a raster to a PNG byte array. */
export function encodePng(image: RasterImage): Uint8Array {
  const { width, height, channels } = image;
  if (width <= 0 || height <= 0) throw new Error('Cannot encode an empty raster.');
  if (width > 0x7fffffff || height > 0x7fffffff) throw new Error('Raster too large for PNG.');
  const colorType = channels === 1 ? 0 : channels === 4 ? 6 : 2; // gray | RGBA | RGB
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    const row = image.data.subarray(y * stride, (y + 1) * stride);
    Buffer.from(row.buffer, row.byteOffset, row.byteLength).copy(raw, y * (stride + 1) + 1);
  }
  const parts: Buffer[] = [
    PNG_SIGNATURE,
    chunk('IHDR', ihdr(width, height, colorType)),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ];
  return Buffer.concat(parts);
}

function ihdr(width: number, height: number, colorType: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = colorType;
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace
  return header;
}

function chunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, payload])), 0);
  return Buffer.concat([length, typeBuffer, payload, crcBuffer]);
}

let crcTable: Uint32Array | undefined;
function crc32(buffer: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let k = 0; k < 8; k += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[n] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Parse PNG chunks back for tests: returns { width, height, colorType, idatInflatedBytes }. */
export function inspectPng(png: Uint8Array): { width: number; height: number; colorType: number; dataBytes: number } {
  const buffer = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (buffer.length < 8 || buffer.subarray(0, 8).compare(PNG_SIGNATURE) !== 0) {
    throw new Error('Not a PNG signature.');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let dataBytes = 0;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const payload = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      colorType = payload[9];
    } else if (type === 'IDAT') {
      dataBytes += payload.length;
    }
    offset += 12 + length;
  }
  if (width === 0) throw new Error('No IHDR chunk found.');
  return { width, height, colorType, dataBytes };
}
