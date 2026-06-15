/* ---------------------------------------------------------------------------
   foveation-dr.js — v2 / Vector 2: REAL-PIPELINE bitrate saving (ΔR)
   ---------------------------------------------------------------------------
   v3 — corrected for the cloud pipeline. The integration analysis showed the
   real config is NOT "crush the periphery at sCore=0.76" (that needs an
   impractically wide render) but "reuse the existing render, SUPERSAMPLE the
   core" (sCore > uScale, solved so Φ(XR)=0.5 at the guard extent XR=0.658).

   So this no longer blurs — it does the genuine foveal SQUASH: a separable,
   piecewise-affine remap of the render through Φ (9 drawImage zones: a core
   that is upscaled, peripheries that are downscaled). Flat = the raw render;
   foveated = squash(render). Encode both at constant QP, diff the bytes.

   Sweeps sPeriph; each value gets its own sCore (sCoreForExtent) so the display
   edge always fills the encoded edge — the honest real-pipeline curve.

   HONESTY: ΔR is content-dependent (synthetic panning render); the squash is
   exact (not a blur proxy now); constant-QP if available else VBR (understated).
   The pure math (foveatedPhiInverse, sCoreForExtent) is Node-tested; only the
   WebCodecs encode is unverified here.
--------------------------------------------------------------------------- */

import { CAPTURE } from './frame-tag.js';
import { CORE, sCoreForExtent } from '../replay/foveation.js';
import { GUARD, UV_SCALE } from '../config.js';

const CODEC_CANDIDATES = [
  'avc1.42E01F', 'avc1.42001F', 'avc1.4D401F', 'avc1.640028',
  'vp8', 'vp09.00.31.08', 'av01.0.05M.08',
];
const N_FRAMES = 48;
const SPERIPH_SWEEP = [0.76, 0.55, 0.45, 0.38, 0.30, 0.24]; // 0.76 = flat baseline
const W = CAPTURE.width, H = CAPTURE.height;

// Display core half-widths (from the locked MB core) and the render extent the
// existing guard band provides (centre-relative display-UV).
const xbX = ((CORE.cols[1] - CORE.cols[0]) / 2 / CORE.mbCols) / UV_SCALE; // ≈ 0.296
const xbY = ((CORE.rows[1] - CORE.rows[0]) / 2 / CORE.mbRows) / UV_SCALE; // ≈ 0.336
const XR = 0.5 + GUARD / UV_SCALE;                                        // ≈ 0.658

function setRow(id, text, ok = null) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = ok === null ? '' : ok ? 'ok' : 'bad';
}

// --- content: broadband, irregular, PANNING (stands in for the render) --------
const src = new OffscreenCanvas(W, H), sctx = src.getContext('2d');
const fov = new OffscreenCanvas(W, H), fctx = fov.getContext('2d');

const speckle = new OffscreenCanvas(W, H);
{
  const c = speckle.getContext('2d');
  let s = 0x12345 >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 9000; i++) {
    const g = Math.floor(30 + rnd() * 200);
    c.fillStyle = `rgb(${g},${g},${g})`;
    c.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 6, 2 + rnd() * 6);
  }
}

function drawScene(f) {
  const phase = f / N_FRAMES;
  const g = sctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1a2230'); g.addColorStop(1, '#0e141d');
  sctx.fillStyle = g; sctx.fillRect(0, 0, W, H);
  const offX = Math.round(phase * W * 0.5) % W;
  sctx.drawImage(speckle, offX - W, 0); sctx.drawImage(speckle, offX, 0);
  const bx = Math.round(phase * (W + 200) - 100);
  sctx.fillStyle = '#cfe0ff'; sctx.fillRect(bx, H * 0.35, 140, H * 0.3);
}

// Per-axis: the 3 source→encoded UV segments. Source is laid out linearly
// (slope uScale); encoded core is supersampled (slope sCore).
function segments(xb, sCore) {
  const sc = UV_SCALE * xb, ec = sCore * xb;
  return [
    { s0: 0, s1: 0.5 - sc, e0: 0, e1: 0.5 - ec },           // left periphery (downscaled)
    { s0: 0.5 - sc, s1: 0.5 + sc, e0: 0.5 - ec, e1: 0.5 + ec }, // core (upscaled)
    { s0: 0.5 + sc, s1: 1, e0: 0.5 + ec, e1: 1 },           // right periphery (downscaled)
  ];
}

// The real foveal squash: 9 affine zones map the render into the encoded frame.
function buildSquash(sPeriph) {
  if (sPeriph >= UV_SCALE) return src; // sCore = uScale → identity → flat
  const xs = segments(xbX, sCoreForExtent(xbX, sPeriph, XR));
  const ys = segments(xbY, sCoreForExtent(xbY, sPeriph, XR));
  fctx.imageSmoothingEnabled = true;
  fctx.clearRect(0, 0, W, H);
  for (const sx of xs) for (const sy of ys) {
    fctx.drawImage(src,
      sx.s0 * W, sy.s0 * H, (sx.s1 - sx.s0) * W, (sy.s1 - sy.s0) * H,
      sx.e0 * W, sy.e0 * H, (sx.e1 - sx.e0) * W, (sy.e1 - sy.e0) * H);
  }
  return fov;
}

async function pickCodec() {
  for (const codec of CODEC_CANDIDATES) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, framerate: 30, bitrate: 8_000_000 });
      if (s.supported) return codec;
    } catch { /* try next */ }
  }
  return null;
}

async function encodePass(sPeriph, codec, useQuantizer, qp) {
  let bytes = 0;
  const encoder = new VideoEncoder({
    output: (chunk) => { bytes += chunk.byteLength; },
    error: (e) => setRow('h-status', `encoder error: ${e.message}`, false),
  });
  const cfg = { codec, width: W, height: H, framerate: 30 };
  if (useQuantizer) cfg.bitrateMode = 'quantizer';
  else { cfg.bitrateMode = 'variable'; cfg.bitrate = 12_000_000; }
  if (codec.startsWith('avc1')) cfg.avc = { format: 'annexb' };
  encoder.configure(cfg);

  for (let f = 0; f < N_FRAMES; f++) {
    drawScene(f);
    const frame = new VideoFrame(buildSquash(sPeriph), { timestamp: f });
    const opts = { keyFrame: f === 0 };
    if (useQuantizer) opts.quantizer = qp;
    encoder.encode(frame, opts);
    frame.close();
  }
  await encoder.flush();
  encoder.close();
  return bytes;
}

function renderTable(rows) {
  const head = '<tr><th>S_periph</th><th>sCore (x)</th><th>bytes/frame</th><th>ΔR (bits saved)</th></tr>';
  const body = rows.map((r) =>
    '<tr>' +
    `<td>${r.sPeriph.toFixed(2)}${r.sPeriph >= UV_SCALE ? ' (flat)' : ''}</td>` +
    `<td>${r.sCore.toFixed(2)}</td>` +
    `<td>${(r.bytes / N_FRAMES).toFixed(0)}</td>` +
    `<td class="${r.dr > 0 ? 'ok' : 'bad'}">${r.sPeriph >= UV_SCALE ? '—' : (100 * r.dr).toFixed(1) + '%'}</td>` +
    '</tr>'
  ).join('');
  document.getElementById('h-dr').innerHTML = head + body;
}

async function run() {
  setRow('h-status', 'negotiating codec…');
  const codec = await pickCodec();
  if (!codec) { setRow('h-codec', 'no candidate codec supported here', false); return; }
  setRow('h-codec', `${codec} · render-reuse squash · XR ${XR.toFixed(3)}`, true);

  let useQuantizer = false;
  try {
    const s = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, framerate: 30, bitrateMode: 'quantizer' });
    useQuantizer = !!(s && s.supported);
  } catch { /* not supported */ }
  const qp = codec.startsWith('avc1') ? 30 : 40;
  setRow('h-mode', useQuantizer ? `constant-QP (q=${qp}) — real ΔR` : 'VBR 12 Mbps fallback — ΔR UNDERSTATED', useQuantizer);

  setRow('h-status', 'encoding flat baseline…');
  const flatBytes = await encodePass(UV_SCALE, codec, useQuantizer, qp);

  const rows = [];
  for (const sPeriph of SPERIPH_SWEEP) {
    setRow('h-status', `encoding squash S_periph=${sPeriph}…`);
    const bytes = sPeriph >= UV_SCALE ? flatBytes : await encodePass(sPeriph, codec, useQuantizer, qp);
    rows.push({ sPeriph, sCore: sCoreForExtent(xbX, sPeriph, XR), bytes, dr: (flatBytes - bytes) / flatBytes });
    renderTable(rows);
  }
  setRow('h-status', 'done — this is the REAL render-reuse ΔR (core supersampled)', true);
}

if (!('VideoEncoder' in window)) {
  setRow('h-status', 'WebCodecs not available in this browser', false);
} else {
  setRow('h-status', 'ready — press Run');
  document.getElementById('h-run').addEventListener('click', () => {
    document.getElementById('h-run').disabled = true;
    run().catch((e) => setRow('h-status', `failed: ${e.message}`, false))
      .finally(() => { document.getElementById('h-run').disabled = false; });
  });
}
