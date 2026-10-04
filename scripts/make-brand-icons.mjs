#!/usr/bin/env node
/**
 * Generate the Nexus brand icons from the game's own UI button art.
 *
 *   node scripts/make-brand-icons.mjs
 *
 * Source: assets/branding/nexus-sc2-ui-icon.dds — the StarCraft II command-card
 * button for the Protoss Nexus (76x76, DXT5), the icon the game itself shows for
 * the building. It is decoded here (BC1/BC3/uncompressed, no image library) to
 * assets/branding/nexus-sc2-ui-icon.png, then resampled with a Lanczos-3 kernel
 * to the three files the app serves:
 *
 *   src/app/apple-icon.png  180x180
 *   src/app/icon.png         64x64
 *   src/app/favicon.ico      16/32/48, PNG-in-ICO
 *
 * The 76px asset is the native resolution of this art (it is what the game
 * ships), so the 180px icon is a documented upscale, not a downscale of a
 * bigger original. Run this script rather than editing the outputs by hand.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDds = join(root, "assets/branding/nexus-sc2-ui-icon.dds");
const masterPng = join(root, "assets/branding/nexus-sc2-ui-icon.png");
const outputs = {
  apple: join(root, "src/app/apple-icon.png"),
  icon: join(root, "src/app/icon.png"),
  favicon: join(root, "src/app/favicon.ico"),
};

// --- DDS --------------------------------------------------------------------

function decodeDds(buf) {
  if (buf.toString("latin1", 0, 4) !== "DDS ") throw new Error("not a DDS file");
  const height = buf.readUInt32LE(12);
  const width = buf.readUInt32LE(16);
  const fourcc = buf.toString("latin1", 84, 88);
  const rgba = Buffer.alloc(width * height * 4);
  const put = (x, y, r, g, b, a) => {
    if (x >= width || y >= height) return;
    const o = (y * width + x) * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = a;
  };

  if (fourcc === "DXT1" || fourcc === "DXT5") {
    const blockBytes = fourcc === "DXT1" ? 8 : 16;
    const blocksX = Math.ceil(width / 4);
    const blocksY = Math.ceil(height / 4);
    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        const off = 128 + (by * blocksX + bx) * blockBytes;
        const block = buf.subarray(off, off + blockBytes);
        let alpha = null;
        let color = block;
        if (fourcc === "DXT5") {
          const a0 = block[0];
          const a1 = block[1];
          const bits = block.readUInt32LE(2) + block.readUInt16LE(6) * 2 ** 32;
          const table = [a0, a1, 0, 0, 0, 0, 0, 0];
          if (a0 > a1) {
            for (let i = 1; i <= 6; i++) table[i + 1] = Math.round(((7 - i) * a0 + i * a1) / 7);
          } else {
            for (let i = 1; i <= 4; i++) table[i + 1] = Math.round(((5 - i) * a0 + i * a1) / 5);
          }
          alpha = new Uint8Array(16);
          for (let i = 0; i < 16; i++) alpha[i] = table[Math.floor(bits / 2 ** (3 * i)) % 8];
          color = block.subarray(8);
        }
        // BC1 colour block.
        const c0 = color.readUInt16LE(0);
        const c1 = color.readUInt16LE(2);
        const codes = color.readUInt32LE(4);
        const expand = (c) => [
          Math.round((((c >> 11) & 0x1f) * 255) / 31),
          Math.round((((c >> 5) & 0x3f) * 255) / 63),
          Math.round(((c & 0x1f) * 255) / 31),
        ];
        const e0 = expand(c0);
        const e1 = expand(c1);
        const palette = [e0, e1, e0.map((v, i) => Math.round((v + e1[i]) / 2)), [0, 0, 0]];
        if (c0 > c1) {
          palette[2] = e0.map((v, i) => Math.round((2 * v + e1[i]) / 3));
          palette[3] = e0.map((v, i) => Math.round((v + 2 * e1[i]) / 3));
        }
        const punch = fourcc === "DXT1" && c0 <= c1;
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            const local = y * 4 + x;
            const idx = (codes >> (2 * local)) & 0x3;
            const [r, g, b] = palette[idx];
            put(bx * 4 + x, by * 4 + y, r, g, b, alpha ? alpha[local] : punch && idx === 3 ? 0 : 255);
          }
        }
      }
    }
    return { width, height, rgba };
  }

  if (buf.readUInt32LE(80) & 0x40) {
    const bpp = buf.readUInt32LE(88) / 8;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = 128 + (y * width + x) * bpp;
        put(x, y, buf[o + 2], buf[o + 1], buf[o], bpp === 4 ? buf[o + 3] : 255);
      }
    }
    return { width, height, rgba };
  }
  throw new Error(`unsupported DDS format: ${fourcc}`);
}

// --- resampling -------------------------------------------------------------

const lanczos = (x) => {
  if (x === 0) return 1;
  const ax = Math.abs(x);
  if (ax >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
};

/** Lanczos-3 resize on premultiplied alpha, so soft edges do not fringe. */
function resize({ width: sw, height: sh, rgba }, dw, dh) {
  const src = new Float32Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const a = rgba[i * 4 + 3] / 255;
    src[i * 4] = rgba[i * 4] * a;
    src[i * 4 + 1] = rgba[i * 4 + 1] * a;
    src[i * 4 + 2] = rgba[i * 4 + 2] * a;
    src[i * 4 + 3] = a;
  }
  const taps = (srcLen, dstLen) => {
    const scale = srcLen / dstLen;
    const filterScale = Math.max(1, scale);
    const out = [];
    for (let i = 0; i < dstLen; i++) {
      const center = (i + 0.5) * scale - 0.5;
      const from = Math.ceil(center - 3 * filterScale);
      const to = Math.floor(center + 3 * filterScale);
      const list = [];
      let sum = 0;
      for (let t = from; t <= to; t++) {
        if (t < 0 || t >= srcLen) continue;
        const w = lanczos((t - center) / filterScale);
        if (w === 0) continue;
        list.push([t, w]);
        sum += w;
      }
      out.push(list.map(([t, w]) => [t, w / sum]));
    }
    return out;
  };
  const xs = taps(sw, dw);
  const ys = taps(sh, dh);
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const [sy, wy] of ys[y]) {
        for (const [sx, wx] of xs[x]) {
          const w = wx * wy;
          const o = (sy * sw + sx) * 4;
          r += src[o] * w;
          g += src[o + 1] * w;
          b += src[o + 2] * w;
          a += src[o + 3] * w;
        }
      }
      const o = (y * dw + x) * 4;
      const av = Math.max(0, Math.min(1, a));
      const un = av > 0 ? 1 / av : 0;
      out[o] = Math.max(0, Math.min(255, Math.round(r * un)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round(g * un)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round(b * un)));
      out[o + 3] = Math.round(av * 255);
    }
  }
  return { width: dw, height: dh, rgba: out };
}

// --- PNG + ICO --------------------------------------------------------------

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const pngChunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])), 8 + data.length);
  return out;
};
function encodePng({ width, height, rgba }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
/** ICONDIR + ICONDIRENTRY[] + PNG payloads (Vista+ PNG-in-ICO). */
function encodeIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, buf }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size === 256 ? 0 : size, e);
    header.writeUInt8(size === 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(buf.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.buf)]);
}

// --- build ------------------------------------------------------------------

const source = decodeDds(readFileSync(sourceDds));
mkdirSync(dirname(masterPng), { recursive: true });
writeFileSync(masterPng, encodePng(source));
writeFileSync(outputs.apple, encodePng(resize(source, 180, 180)));
writeFileSync(outputs.icon, encodePng(resize(source, 64, 64)));
writeFileSync(
  outputs.favicon,
  encodeIco([16, 32, 48].map((size) => ({ size, buf: encodePng(resize(source, size, size)) }))),
);

console.log(`source  ${source.width}x${source.height} DXT asset -> ${masterPng}`);
console.log(`wrote   apple-icon.png 180x180, icon.png 64x64, favicon.ico 16/32/48`);
