/* ---------------------------------------------------------------------------
   pose-media.js — v2 / Vector 1, increment 3: Pose-Tagged Media protocol + A/B
   ---------------------------------------------------------------------------
   Increment 1 (tag-codec.js) proved the carrier: an integer frameId rides
   losslessly as codec metadata. This module is the PROTOCOL around it and the
   A/B INSTRUMENT that compares it to the live pixel tag on the three axes
   Vector 1 cares about — sync exactness, bitrate overhead, drop resilience.

   THE PROTOCOL. Each streamed frame carries:
     • frameId  → the codec's own timestamp (EncodedVideoChunk.timestamp; it is
                  monotonic, so it doubles as presentation order), and
     • a sidecar FrameMeta {frameId, g, …} that rides BESIDE the media (the
       DataChannel today, a MoQ object tomorrow) and is matched back to its
       frame by frameId via the EXISTING PoseSync.byFrameId — no new matcher.
   `g` (the guard-band fraction) is carried now so Vector 2's per-frame foveated
   crop already has a channel; nothing reads it yet (designed to extend).

   WHY frameId in-band AND a sidecar: the in-band timestamp ties the id's fate
   to the frame's fate (lose the chunk → lose both; NO independent failure
   mode). A separate sidecar adds one failure mode — frame arrives, its sidecar
   dropped — so we never depend on the sidecar for the *id*: the id is always
   recoverable in-band, the sidecar only enriches it (pose/g). TagABTelemetry
   measures exactly that gap.

   The browser half (webcodecs-harness.js) does the actual VideoEncoder/Decoder
   round-trip and feeds RAW observations in here; ALL arithmetic lives here so
   it is unit-tested in Node, no browser, no WebCodecs. (Pure: no DOM.)
--------------------------------------------------------------------------- */

import { percentile } from './cloud-recorder.js';

/** Peak-SNR in dB from a mean squared error over 0..`peak` samples (for the
 *  guard-band spillover measurement: tagged vs clean decoded quality). */
export function psnrFromMse(mse, peak = 255) {
  return mse <= 0 ? Infinity : 10 * Math.log10((peak * peak) / mse);
}

/** Build a validated per-frame sidecar record. `g` is the guard-band fraction. */
export function makeFrameMeta(frameId, g) {
  return validateFrameMeta({ frameId: frameId & 0xffff, g });
}

/** Throws with a readable message if `m` is not a valid FrameMeta. */
export function validateFrameMeta(m) {
  if (!m || !Number.isInteger(m.frameId) || m.frameId < 0 || m.frameId > 0xffff) {
    throw new Error(`FrameMeta: frameId must be a 16-bit int, got ${m && m.frameId}`);
  }
  if (!Number.isFinite(m.g) || m.g < 0 || m.g >= 0.5) {
    throw new Error(`FrameMeta: g must be in [0, 0.5), got ${m && m.g}`);
  }
  return m;
}

/**
 * Accumulates per-frame A/B observations from the WebCodecs harness and answers
 * the three Vector-1 questions. One `observe()` per frame the server emitted.
 */
export class TagABTelemetry {
  constructor() {
    this.frames = 0;          // frames the server emitted (the denominator)
    this.delivered = 0;       // …whose media chunk arrived (decodable)
    this.inbandIdHits = 0;    // arrived frames whose in-band timestamp == frameId
    this.sidecarIdHits = 0;   // arrived frames whose sidecar ALSO arrived
    this.pixelChecked = 0;    // arrived frames where a pixel id was read
    this.pixelHits = 0;       // …and the pixel id == frameId
    this.bytesTagged = [];    // per-frame encoded size WITH the pixel tag baked in
    this.bytesClean = [];     // per-frame encoded size WITHOUT it (metadata path)
  }

  /**
   * @param {object} o
   * @param {number}  o.frameId                the id the server baked/sent
   * @param {number|null} o.metaId             decoded VideoFrame.timestamp (null if chunk dropped)
   * @param {number|null} o.pixelId            id read from the decoded pixels (null if N/A)
   * @param {number|null} o.bytesTagged        encoded bytes with the pixel tag (encode-side; known even if dropped)
   * @param {number|null} o.bytesClean         encoded bytes without it
   * @param {boolean} o.chunkDropped           the media chunk was lost in transit
   * @param {boolean} o.sidecarDropped         the sidecar packet was lost in transit
   */
  observe(o) {
    this.frames++;
    // Bytes are an encode-side measurement — recorded regardless of transit loss.
    if (Number.isFinite(o.bytesTagged)) this.bytesTagged.push(o.bytesTagged);
    if (Number.isFinite(o.bytesClean)) this.bytesClean.push(o.bytesClean);

    if (o.chunkDropped) return; // a lost frame is never displayed; ids are moot
    this.delivered++;

    const fid = o.frameId & 0xffff;
    if (o.metaId !== null && o.metaId !== undefined && (o.metaId & 0xffff) === fid) this.inbandIdHits++;
    if (!o.sidecarDropped) this.sidecarIdHits++;
    if (o.pixelId !== null && o.pixelId !== undefined) {
      this.pixelChecked++;
      if ((o.pixelId & 0xffff) === fid) this.pixelHits++;
    }
  }

  summary() {
    const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
    const tagged = mean(this.bytesTagged), clean = mean(this.bytesClean);
    const d = this.delivered;
    return {
      frames: this.frames,
      delivered: d,
      // AXIS 1 — sync exactness: fraction of displayed frames whose recovered
      // id matched the true id. Metadata should be exactly 1 (never quantised).
      sync: {
        metadataExactRate: d ? this.inbandIdHits / d : NaN,
        pixelExactRate: this.pixelChecked ? this.pixelHits / this.pixelChecked : NaN,
      },
      // AXIS 2 — bitrate overhead the PIXEL tag imposes vs the metadata path
      // (which spends zero pixels). PROJECTED until the harness feeds real
      // encoder bytes; the arithmetic here is exact, the inputs are what vary.
      bytes: {
        taggedMean: tagged, cleanMean: clean,
        taggedP95: percentile(this.bytesTagged, 95),
        cleanP95: percentile(this.bytesClean, 95),
        pixelTagOverheadPct: (Number.isFinite(tagged) && Number.isFinite(clean) && clean > 0)
          ? (100 * (tagged - clean) / clean) : NaN,
      },
      // AXIS 3 — drop resilience: of frames that arrived (so we WANT their id),
      // how often was the id available? In-band is 1 by construction; a
      // sidecar-only scheme loses the id whenever the sidecar dropped.
      drops: {
        inbandIdAvailability: d ? this.inbandIdHits / d : NaN,
        sidecarIdAvailability: d ? this.sidecarIdHits / d : NaN,
      },
    };
  }
}
