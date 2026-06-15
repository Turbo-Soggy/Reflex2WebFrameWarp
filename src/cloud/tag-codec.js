/* ---------------------------------------------------------------------------
   tag-codec.js — v2 / Vector 1, increment 1: the frame-ID *carrier* abstraction
   ---------------------------------------------------------------------------
   Vector 1's whole move is to stop hiding the frameId in PIXELS and instead
   carry it as codec METADATA (WebCodecs EncodedVideoChunk.timestamp first;
   later an H.264 SEI NAL / AV1 metadata OBU). This module makes both carriers
   concrete and PURE so the claim can be tested in Node, no browser:

     • a PIXEL carrier  — a faithful CPU mirror of the live steganographic tag.
       The server bakes a 4×4 luminance grid; the client thresholds it back.
       (See frame-tag.js for the geometry and readFrameTag() in client-main.js
       for the decoder this mirrors byte-for-byte.)

     • a METADATA carrier — the integer rides BESIDE the frame, untouched.

   THE POINT (proved by test, not asserted): the metadata carrier has EXACTLY
   zero decode error by construction — an integer copied, never quantised —
   whereas the pixel carrier has a nonzero, degradation-dependent bit-error
   rate. The metadata carrier also reclaims the 64×64 guard-band pixels the
   pixel tag spends. So on both the tag-error axis and the pixel-cost axis the
   metadata carrier strictly dominates.

   HONESTY (the load-bearing caveat): the pixel degradation modelled here is an
   *illustrative proxy* — contrast collapse toward mid-grey (what an encoder
   does as it runs out of bits) plus Gaussian noise — NOT a real H.264/AV1
   codec. It demonstrates the failure MODE the metadata carrier provably lacks;
   it does NOT measure the real-world magnitude of pixel BER. That number needs
   a browser WebCodecs encode→decode harness (a later increment), which this
   Node environment cannot run. Metadata BER = 0 is exact; pixel BER > 0 here
   is directional.

   Pure data + math (no DOM, no THREE) → unit-testable in Node.
--------------------------------------------------------------------------- */

import { TAG, idToBits, bitsToId, cellRect } from './frame-tag.js';

// --- PIXEL carrier ----------------------------------------------------------

/**
 * Encode an id into a TAG.px × TAG.px single-channel luminance buffer:
 * bit true → white (255), bit false → black (0). This is the CPU equivalent
 * of the server's WebGL scissor grid; row-major, same cell layout as the live
 * tag, so decodePixelTag() is its exact inverse on a clean channel.
 */
export function encodePixelTag(id) {
  const bits = idToBits(id);
  const n = TAG.px;
  const lum = new Uint8ClampedArray(n * n);
  for (let i = 0; i < TAG.bits; i++) {
    const v = bits[i] ? 255 : 0;
    const r = cellRect(i);
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) lum[y * n + x] = v;
    }
  }
  return lum;
}

/**
 * Decode an id from a luminance buffer. Byte-faithful to readFrameTag() in
 * client-main.js: average a 4×4 block at each cell's CENTRE (away from the
 * edge ringing of lossy compression) and threshold the average at mid-grey.
 * @param {Uint8ClampedArray|number[]} lum  row-major luminance, stride `n`
 * @param {number} n  row stride in pixels (defaults to the nominal tag width)
 */
export function decodePixelTag(lum, n = TAG.px) {
  const bits = [];
  for (let i = 0; i < TAG.bits; i++) {
    const r = cellRect(i);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let sum = 0;
    for (let dy = -2; dy < 2; dy++) {
      for (let dx = -2; dx < 2; dx++) sum += lum[(cy + dy) * n + (cx + dx)];
    }
    bits.push(sum / 16 > 127);
  }
  return bitsToId(bits);
}

// --- METADATA carrier (the Vector-1 leap) -----------------------------------
// The frameId rides as integer metadata: WebCodecs sets it as the
// EncodedVideoChunk.timestamp on encode and reads it straight back off the
// decoded VideoFrame.timestamp — no pixels, no quantisation. Modelled here as
// the identity (16-bit masked, matching the pixel tag's wrap at 65536 frames)
// because that is *exactly* what a lossless integer side-channel is.

export function encodeMetaTag(id) { return id & 0xffff; }
export function decodeMetaTag(timestamp) { return timestamp & 0xffff; }

// --- degradation proxy (see the HONESTY note in the file header) ------------

/**
 * Collapse cell contrast toward mid-grey by `strength` ∈ [0,1] (what a codec
 * does as it runs out of bits) then add zero-mean Gaussian noise (σ in 0..255
 * luminance units). Deterministic when given a seeded `rng`.
 */
export function degradeLuminance(lum, { strength = 0, sigma = 0, rng = Math.random } = {}) {
  const MID = 127.5;
  const out = new Uint8ClampedArray(lum.length);
  for (let i = 0; i < lum.length; i++) {
    const collapsed = lum[i] + (MID - lum[i]) * strength;
    // Box–Muller: one standard-normal sample from two uniforms.
    const u1 = Math.max(rng(), 1e-12), u2 = rng();
    const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out[i] = collapsed + g * sigma;
  }
  return out;
}

/** Guard-band source pixels each carrier spends on the tag (metadata: none). */
export const TAG_PIXEL_COST = { pixel: TAG.px * TAG.px, metadata: 0 };

/** Hamming distance between two ids over the 16 tag bits (0..16) — the BER unit. */
export function tagBitErrors(idTrue, idGot) {
  const a = idToBits(idTrue & 0xffff), b = idToBits(idGot & 0xffff);
  let n = 0;
  for (let i = 0; i < TAG.bits; i++) if (a[i] !== b[i]) n++;
  return n;
}
