/* ---------------------------------------------------------------------------
   webcodecs-harness.js — v2 / Vector 1, increment 3: BROWSER stress sweep
   ---------------------------------------------------------------------------
   Drives a real VideoEncoder → VideoDecoder round-trip at a SWEEP of bitrates
   to find the cliff where the steganographic pixel tag starts losing bits while
   the metadata carrier (frameId in VideoFrame.timestamp) stays invariant. The
   "killer chart" for Vector 1: pixel carrier is robust down to some kbps, below
   which quantisation flips tag bits; metadata is flat across all of it.

   Per bitrate it measures, using Node-tested math (tag-codec.js / pose-media.js):
     • pixel exactness + tag BER  — the cliff and its shape (gradual, not a
       cascade: each frame's tag is independent, so a flip is a single-frame
       miss, not a desync).
     • metadata exactness         — should read 100% at every bitrate.
     • guard-band spillover (dB)  — PSNR of the band NEXT TO the tag, tagged vs
       clean encode at the same bitrate: if the high-contrast tag steals bits
       from its neighbours, tagged PSNR drops below clean.

   HONESTY: not verified by its author in a browser (this env has no WebCodecs,
   no ffmpeg). The arithmetic is green in Node; only the WebCodecs + canvas glue
   below is unrun. The exact cliff kbps is encoder-specific — your hardware AVC
   will differ from, say, libx264 — and depends on scene complexity; read the
   SHAPE and the metadata-invariance, not the absolute number, as the result.
   Likely weak point: reading pixels back off a decoded VideoFrame (readStrip).
--------------------------------------------------------------------------- */

import { CAPTURE, TAG, idToBits, cellRect } from './frame-tag.js';
import { decodePixelTag, tagBitErrors } from './tag-codec.js';
import { psnrFromMse } from './pose-media.js';

const CODEC_CANDIDATES = [
  'avc1.42E01F', 'avc1.42001F', 'avc1.4D401F', 'avc1.640028',
  'vp8', 'vp09.00.31.08', 'av01.0.05M.08',
];
const BITRATE_SWEEP_KBPS = [4000, 2000, 1000, 500, 300, 150, 75, 40];
const N_FRAMES = 90;                 // 3 s at 30 fps
const GUARD = 0.12;

const W = CAPTURE.width, H = CAPTURE.height;
const RB_W = 256, RB_H = TAG.px;     // readback strip: tag [0,64) + neighbour band [64,256)

function setRow(id, text, ok = null) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = ok === null ? '' : ok ? 'ok' : 'bad';
}

// --- synthetic content: a deterministic function of frameId -------------------
// Moderately detailed (gradient + static verticals + a panning bar) so the
// encoder actually has to spend bits — otherwise low-bitrate quantisation, the
// thing we want to provoke, never bites. SAME content for tagged & clean runs.
const scene = new OffscreenCanvas(W, H);
const sctx = scene.getContext('2d');

function drawScene(frameId, withTag) {
  const phase = frameId / N_FRAMES;
  const grad = sctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, `hsl(${Math.round(phase * 360)}, 35%, 18%)`);
  grad.addColorStop(1, `hsl(${Math.round((phase * 360 + 120) % 360)}, 35%, 8%)`);
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, W, H);
  sctx.fillStyle = 'rgba(255,255,255,0.05)';           // high-freq detail to spend bits on
  for (let x = 0; x < W; x += 37) sctx.fillRect(x, 0, 2, H);
  const bx = Math.round(phase * (W + 240) - 120);      // panning bar = inter-frame motion
  sctx.fillStyle = '#3a4a66';
  sctx.fillRect(bx, H * 0.3, 160, H * 0.4);

  if (withTag) {                                        // the 4×4 corner grid (frame-tag.js geometry)
    const bits = idToBits(frameId);
    for (let i = 0; i < TAG.bits; i++) {
      const r = cellRect(i);
      sctx.fillStyle = bits[i] ? '#fff' : '#000';
      sctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }
  return scene;
}

// --- read the top-left RB_W×RB_H strip of a frame as luma --------------------
const readback = new OffscreenCanvas(RB_W, RB_H);
const rctx = readback.getContext('2d', { willReadFrequently: true });

function readStrip(source) {
  rctx.drawImage(source, 0, 0, RB_W, RB_H, 0, 0, RB_W, RB_H);
  const rgba = rctx.getImageData(0, 0, RB_W, RB_H).data;
  const lum = new Uint8ClampedArray(RB_W * RB_H);
  for (let i = 0; i < lum.length; i++) {
    lum[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return lum;
}

// MSE of the neighbour band (x in [TAG.px, RB_W)) — the tag itself is excluded.
function bandMse(decLum, refLum) {
  let se = 0, n = 0;
  for (let y = 0; y < RB_H; y++) {
    for (let x = TAG.px; x < RB_W; x++) {
      const i = y * RB_W + x, d = decLum[i] - refLum[i];
      se += d * d; n++;
    }
  }
  return se / n;
}

/** First candidate codec the browser+hardware will actually encode. */
async function pickCodec() {
  for (const codec of CODEC_CANDIDATES) {
    try {
      const s = await VideoEncoder.isConfigSupported({
        codec, width: W, height: H, bitrate: 1_000_000, framerate: 30,
      });
      if (s.supported) return codec;
    } catch { /* unknown codec string — try the next */ }
  }
  return null;
}

// --- one encode→decode pass at a given bitrate -------------------------------
// Returns Map frameId → { bytes, metaId, strip } (strip = decoded luma readback).
async function runPath(withTag, codec, bitrateBps) {
  const bytesByFrame = new Map();
  const decoded = new Map();
  const isAvc = codec.startsWith('avc1');

  const decoder = new VideoDecoder({
    output: (frame) => {
      decoded.set(frame.timestamp, { metaId: frame.timestamp, strip: readStrip(frame) });
      frame.close();
    },
    error: (e) => setRow('h-status', `decoder error: ${e.message}`, false),
  });
  decoder.configure({ codec, codedWidth: W, codedHeight: H, optimizeForLatency: true });

  const chunks = [];
  const encoder = new VideoEncoder({
    output: (chunk) => { bytesByFrame.set(chunk.timestamp, chunk.byteLength); chunks.push(chunk); },
    error: (e) => setRow('h-status', `encoder error: ${e.message}`, false),
  });
  const cfg = { codec, width: W, height: H, bitrate: bitrateBps, framerate: 30 };
  if (isAvc) cfg.avc = { format: 'annexb' };
  encoder.configure(cfg);

  for (let f = 0; f < N_FRAMES; f++) {
    const frame = new VideoFrame(drawScene(f, withTag), { timestamp: f });
    encoder.encode(frame, { keyFrame: f % 30 === 0 });
    frame.close();
  }
  await encoder.flush();
  for (const chunk of chunks) decoder.decode(chunk);
  await decoder.flush();
  encoder.close();
  decoder.close();

  const out = new Map();
  for (let f = 0; f < N_FRAMES; f++) {
    const d = decoded.get(f);
    out.set(f, { bytes: bytesByFrame.get(f) ?? 0, metaId: d ? d.metaId : null, strip: d ? d.strip : null });
  }
  return out;
}

// --- render the sweep table (incrementally, as rows complete) ----------------
function renderSweep(rows) {
  const head = '<tr><th>target<br>kbps</th><th>actual<br>kbps</th><th>pixel<br>exact</th>' +
    '<th>tag<br>BER</th><th>frames<br>w/ err</th><th>meta<br>exact</th><th>guard<br>spill dB</th></tr>';
  const body = rows.map(r =>
    '<tr>' +
    `<td>${r.targetKbps}</td>` +
    `<td>${r.actualKbps.toFixed(0)}</td>` +
    `<td class="${r.pixelExactRate < 1 ? 'bad' : 'ok'}">${(100 * r.pixelExactRate).toFixed(1)}%</td>` +
    `<td>${(100 * r.ber).toFixed(2)}%</td>` +
    `<td>${r.framesErr}/${r.framesChecked}</td>` +
    `<td class="${r.metaExactRate === 1 ? 'ok' : 'bad'}">${(100 * r.metaExactRate).toFixed(1)}%</td>` +
    `<td>${Number.isFinite(r.spilloverDb) ? r.spilloverDb.toFixed(2) : '∞'}</td>` +
    '</tr>'
  ).join('');
  document.getElementById('h-sweep').innerHTML = head + body;
}

async function runSweep() {
  setRow('h-status', 'negotiating codec…');
  const codec = await pickCodec();
  if (!codec) { setRow('h-codec', `none of ${CODEC_CANDIDATES.length} candidate codecs supported here`, false); return; }
  setRow('h-codec', `${codec} · ${W}×${H} · 30 fps · g=${GUARD}`, true);

  // Reference (un-encoded) neighbour-band luma, once — the spillover baseline.
  const refStrips = new Map();
  for (let f = 0; f < N_FRAMES; f++) { drawScene(f, false); refStrips.set(f, readStrip(scene)); }

  const rows = [];
  for (const targetKbps of BITRATE_SWEEP_KBPS) {
    setRow('h-status', `encoding at ${targetKbps} kbps…`);
    const tagged = await runPath(true, codec, targetKbps * 1000);
    const clean = await runPath(false, codec, targetKbps * 1000);

    let bitErrs = 0, framesErr = 0, framesChecked = 0, metaOk = 0, delivered = 0;
    let bytes = 0, mseTagged = 0, mseClean = 0, nT = 0, nC = 0;
    for (let f = 0; f < N_FRAMES; f++) {
      const T = tagged.get(f), C = clean.get(f);
      bytes += T.bytes;
      if (T.strip) {
        delivered++;
        if (T.metaId === f) metaOk++;
        const got = decodePixelTag(T.strip, RB_W);
        const be = tagBitErrors(f, got);
        bitErrs += be; framesChecked++; if (be > 0) framesErr++;
        mseTagged += bandMse(T.strip, refStrips.get(f)); nT++;
      }
      if (C.strip) { mseClean += bandMse(C.strip, refStrips.get(f)); nC++; }
    }
    rows.push({
      targetKbps,
      actualKbps: (bytes / N_FRAMES) * 8 * 30 / 1000,
      pixelExactRate: framesChecked ? (framesChecked - framesErr) / framesChecked : NaN,
      ber: framesChecked ? bitErrs / (TAG.bits * framesChecked) : NaN,
      framesErr, framesChecked,
      metaExactRate: delivered ? metaOk / delivered : NaN,
      spilloverDb: psnrFromMse(mseClean / nC) - psnrFromMse(mseTagged / nT), // clean − tagged (>0 = tag stole bits)
    });
    renderSweep(rows);
  }
  setRow('h-status', 'sweep complete — find the row where "pixel exact" goes red', true);
}

// --- wire up -----------------------------------------------------------------
if (!('VideoEncoder' in window)) {
  setRow('h-status', 'WebCodecs not available in this browser', false);
} else {
  setRow('h-status', 'ready — press Run sweep');
  document.getElementById('h-run').addEventListener('click', () => {
    document.getElementById('h-run').disabled = true;
    runSweep().catch((e) => setRow('h-status', `failed: ${e.message}`, false))
      .finally(() => { document.getElementById('h-run').disabled = false; });
  });
}
