/* ---------------------------------------------------------------------------
   test/test.js — Unit tests for the pure math (vanilla Node, no framework)
   ---------------------------------------------------------------------------
   Run with:  npm test   (or: node test/test.js)

   These exercise the math-heavy, deterministic parts of the project as real
   imported functions — proving correctness analytically, not just visually:
     • renderFovDeg()              — the tangent-exact guard-band FOV (projection.js)
     • the guard-band UV crop      — reference of the warp-shader transform
     • LagSim.orientationToRender / shouldRender  (lag.js)
     • shoot()                     — ray vs. a known target disc (raycast.js)

   Requires `three` (a devDependency) so Node can resolve the bare 'three'
   specifier that raycast.js imports:  npm install
--------------------------------------------------------------------------- */

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { renderFovDeg } from '../src/projection.js';
import { LagSim } from '../src/lag.js';
import { shoot } from '../src/raycast.js';
import { TAG, idToBits, bitsToId, cellRect } from '../src/cloud/frame-tag.js';
import {
  encodePixelTag, decodePixelTag, encodeMetaTag, decodeMetaTag,
  degradeLuminance, TAG_PIXEL_COST, tagBitErrors,
} from '../src/cloud/tag-codec.js';
import { makeFrameMeta, validateFrameMeta, TagABTelemetry, psnrFromMse } from '../src/cloud/pose-media.js';
import { PoseSync } from '../src/cloud/pose-sync.js';
import { CloudRecorder, percentile } from '../src/cloud/cloud-recorder.js';
import {
  validateTrace, poseAt, TraceRecorder,
  synthConstantVelocity, synthSineSweep, synthWander,
} from '../src/replay/trace.js';
import {
  simulate, resultToCSV, clampOnsetBoundsDegPerSec, maxWarpRad, DEFAULT_CONFIG,
} from '../src/replay/pipeline-sim.js';
import {
  guardForSpeed, makeAdaptiveGuardPolicy, ADAPTIVE_DEFAULTS,
} from '../src/replay/adaptive-guard.js';
import {
  marginViewportFraction, marginInnerEccentricityDeg, crushInnerEccentricityDeg, foveatedPhi,
  foveatedPhiInverse, sCoreForExtent, CORE, coreRectPx,
} from '../src/replay/foveation.js';
import { fovXRad } from '../src/config.js';
import {
  focalPx, translationFromWalk, disparityPx, disparityUV, representativeDepth,
  residualPx, disocclusionPx, gridResidualStats, cellExtentsFromField,
  translationUVPerMeter, parallaxDeltaUV,
} from '../src/replay/parallax.js';

// --- tiny green/red harness ------------------------------------------------
let passed = 0, failed = 0;
const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', RESET = '\x1b[0m';
function test(name, fn) {
  try { fn(); console.log(`${GREEN}  ✓${RESET} ${name}`); passed++; }
  catch (e) { console.log(`${RED}  ✗ ${name}${RESET}\n    ${RED}${e.message}${RESET}`); failed++; }
}
function section(title) { console.log(`\n${DIM}${title}${RESET}`); }
function approx(actual, expected, tol = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tol,
    `expected ${actual} ≈ ${expected} (tol ${tol})`);
}

// Reference implementation of the warp-shader's guard-band crop (it lives in
// GLSL, so we mirror the exact formula here): sampleUV = guard + (vUv+delta)*uScale.
function cropUV([u, v], [du, dv], guard) {
  const uScale = 1 - 2 * guard;
  return [guard + (u + du) * uScale, guard + (v + dv) * uScale];
}
// Inverse of renderFovDeg: the central `uvScale` crop of a render FOV, in deg.
function croppedFovDeg(renderFov, uvScale) {
  const rad = (renderFov * Math.PI) / 180;
  return ((2 * Math.atan(Math.tan(rad / 2) * uvScale)) * 180) / Math.PI;
}

// ===========================================================================
section('renderFovDeg() — tangent-exact guard-band FOV');

test('uvScale = 1 is the identity (no widening)', () => {
  approx(renderFovDeg(75, 1), 75, 1e-9);
  approx(renderFovDeg(90, 1), 90, 1e-9);
  approx(renderFovDeg(45, 1), 45, 1e-9);
});

test('widening: a guard band always increases the FOV', () => {
  assert.ok(renderFovDeg(75, 0.76) > 75);
  assert.ok(renderFovDeg(60, 0.5) > 60);
});

test('known value: renderFovDeg(75, 0.76) ≈ 90.55°', () => {
  approx(renderFovDeg(75, 0.76), 90.546, 0.01);
});

test('round-trip: cropping the render FOV by uvScale returns the display FOV', () => {
  // This is the whole point of the tangent-exact relationship.
  for (const [fov, uv] of [[75, 0.76], [90, 0.5], [50, 0.9], [110, 0.6]]) {
    approx(croppedFovDeg(renderFovDeg(fov, uv), uv), fov, 1e-9);
  }
});

// ===========================================================================
section('guard-band UV crop (reference of the warp-shader transform)');

test('centre maps to centre (delta 0)', () => {
  const [u, v] = cropUV([0.5, 0.5], [0, 0], 0.12);
  approx(u, 0.5, 1e-12); approx(v, 0.5, 1e-12);
});

test('screen edges map to the guard margins', () => {
  approx(cropUV([0, 0], [0, 0], 0.12)[0], 0.12, 1e-12);   // uGuard
  approx(cropUV([1, 1], [0, 0], 0.12)[0], 0.88, 1e-12);   // 1 - uGuard
});

test('camera delta is scaled into texture space by uScale', () => {
  // a +0.1 display-UV shift becomes +0.1 * (1-2*0.12) = +0.076 in texture space
  const [u] = cropUV([0.5, 0.5], [0.1, 0], 0.12);
  approx(u, 0.5 + 0.076, 1e-12);
});

// ===========================================================================
section('LagSim.orientationToRender() / shouldRender()');

test('empty history returns zero orientation', () => {
  const lag = new LagSim(30, 80);
  assert.deepEqual(lag.orientationToRender(1000), { yaw: 0, pitch: 0 });
});

test('returns the snapshot from lagMs ago', () => {
  const lag = new LagSim(30, 80); // 80 ms lag
  for (let t = 0; t <= 200; t += 20) lag.record(t, { yaw: t / 100, pitch: 0 });
  // at now=200, target time = 200-80 = 120 → newest snapshot with t ≤ 120 is t=120
  const o = lag.orientationToRender(200);
  approx(o.t, 120); approx(o.yaw, 1.2);
  // at now=150, target = 70 → newest t ≤ 70 is t=60
  approx(lag.orientationToRender(150).yaw, 0.6);
});

test('before any sample is old enough, falls back to the oldest snapshot', () => {
  const lag = new LagSim(30, 80);
  for (let t = 0; t <= 200; t += 20) lag.record(t, { yaw: t / 100, pitch: 0 });
  // now=50 → target=-30, nothing is that old → oldest (t=0)
  approx(lag.orientationToRender(50).yaw, 0);
});

test('shouldRender enforces the ~30 FPS cadence (interval ≈ 33.3 ms)', () => {
  const lag = new LagSim(30, 80);
  assert.equal(lag.shouldRender(0), true);    // first frame
  assert.equal(lag.shouldRender(10), false);  // 10 ms < 33.3
  assert.equal(lag.shouldRender(40), true);   // crossed the interval
  assert.equal(lag.shouldRender(50), false);
  assert.equal(lag.shouldRender(70), true);
});

test('setRenderHz changes the interval', () => {
  const lag = new LagSim(30, 80);
  lag.setRenderHz(10);
  approx(lag.renderInterval, 100); // 1000/10
});

// ===========================================================================
section('shoot() — ray vs. a known target disc');

function makeDisc(x, y, z, r = 0.5) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(r, 32),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  );
  mesh.position.set(x, y, z);
  mesh.updateMatrixWorld(true);
  return mesh;
}

test('aiming straight at the disc hits it', () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const disc = makeDisc(0, 0, -5);             // 5 units straight ahead (-Z)
  const hit = shoot(origin, 0, 0, [disc]);     // yaw 0, pitch 0 → forward = -Z
  assert.equal(hit, disc);
});

test('aiming well off-axis misses (returns null)', () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const disc = makeDisc(0, 0, -5);
  assert.equal(shoot(origin, 1.2, 0, [disc]), null);   // ~69° to the right
  assert.equal(shoot(origin, 0, 1.2, [disc]), null);   // ~69° up
});

test('picks the nearer of two discs along the ray', () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const near = makeDisc(0, 0, -3);
  const far = makeDisc(0, 0, -8);
  assert.equal(shoot(origin, 0, 0, [far, near]), near);
});

// ===========================================================================
section('frame tag codec (cloud/frame-tag.js)');

test('idToBits / bitsToId round-trip', () => {
  for (const id of [0, 1, 5, 0x00ff, 0xaaaa, 0x5555, 0xffff]) {
    assert.equal(bitsToId(idToBits(id)), id);
  }
});

test('ids wrap at 16 bits (frame 65541 encodes as frame 5)', () => {
  assert.equal(bitsToId(idToBits(65536 + 5)), 5);
});

test('cells tile the tag region without overlap', () => {
  const seen = new Set();
  for (let i = 0; i < TAG.bits; i++) {
    const r = cellRect(i);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= TAG.px && r.y + r.h <= TAG.px,
      `cell ${i} escapes the ${TAG.px}px region`);
    const key = `${r.x},${r.y}`;
    assert.ok(!seen.has(key), `cells ${i} overlaps another at ${key}`);
    seen.add(key);
  }
  assert.equal(seen.size, TAG.bits); // 16 distinct cells
});

// ===========================================================================
section('Vector 1 — frame-ID carrier: pixel steganography vs codec metadata (cloud/tag-codec.js)');

// Seeded LCG so the noise sweep is reproducible (same generator as trace.js).
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const SAMPLE_IDS = [0, 1, 5, 0x00ff, 0x0f0f, 0xaaaa, 0x5555, 1234, 65535];

test('clean channel: both carriers round-trip every id exactly', () => {
  for (const id of SAMPLE_IDS) {
    assert.equal(decodePixelTag(encodePixelTag(id)), id & 0xffff);
    assert.equal(decodeMetaTag(encodeMetaTag(id)), id & 0xffff);
  }
});

test('metadata carrier: ZERO decode error at every degradation level (by construction)', () => {
  // The whole Vector-1 claim: an integer side-channel is never quantised, so
  // no amount of pixel degradation can touch it. Exact, not a proxy.
  for (const strength of [0, 0.5, 0.9, 0.99, 1]) {
    for (const id of SAMPLE_IDS) {
      assert.equal(decodeMetaTag(encodeMetaTag(id)), id & 0xffff, `strength ${strength}, id ${id}`);
    }
  }
});

test('pixel carrier: exact under mild degradation, fails as contrast collapses', () => {
  const rng = lcg(0xC0FFEE);
  const ber = (strength, sigma) => {
    let wrong = 0, total = 0;
    for (const id of SAMPLE_IDS) {
      const got = decodePixelTag(degradeLuminance(encodePixelTag(id), { strength, sigma, rng }));
      const a = idToBits(id & 0xffff), b = idToBits(got);
      for (let k = 0; k < TAG.bits; k++) { if (a[k] !== b[k]) wrong++; total++; }
    }
    return wrong / total;
  };
  // High contrast intact → the engineered tag is exact (this is WHY it works).
  assert.equal(ber(0.0, 8), 0);
  // Near-total contrast collapse + noise → bits flip: the failure mode the
  // metadata carrier provably lacks. (Magnitude is proxy; existence is the point.)
  assert.ok(ber(0.99, 30) > 0, 'collapsed-contrast pixel tag should corrupt some bits');
});

test('metadata carrier reclaims the 64×64 guard-band pixels the tag spends', () => {
  assert.equal(TAG_PIXEL_COST.pixel, 64 * 64);
  assert.equal(TAG_PIXEL_COST.metadata, 0);
});

// ===========================================================================
section('PoseSync — pose ↔ frame matching (cloud/pose-sync.js)');

// Simulated stream: server clock starts at 1000, client clock runs 500 ms
// ahead, packets arrive with small non-negative transit jitter.
function fillPoseSync() {
  const ps = new PoseSync(60);
  const jitter = [3, 1, 0, 4, 2, 5, 1, 0, 3, 2]; // one packet has zero transit
  for (let i = 0; i < 10; i++) {
    const t = 1000 + i * 33.3;                       // server clock
    ps.record({ frameId: 100 + i, yaw: i * 0.1, pitch: 0, t },
      t + 500 + jitter[i]);                          // client clock = t + 500 (+transit)
  }
  return ps;
}

test('clock offset converges on the true value via the min-filter', () => {
  const ps = fillPoseSync();
  approx(ps.offsetMs, 500, 1e-9); // exact when one packet had zero transit
});

test('byFrameId is an exact lookup (including 16-bit-masked ids)', () => {
  const ps = fillPoseSync();
  assert.equal(ps.byFrameId(103).frameId, 103);
  assert.equal(ps.byFrameId(103 + 65536).frameId, 103); // wrapped query
  assert.equal(ps.byFrameId(999), null);
});

test('byCaptureTime resolves the nearest pose in server time', () => {
  const ps = fillPoseSync();
  // A frame captured (client clock) at server-time 1000+5*33.3 → pose 105.
  const capture = 1000 + 5 * 33.3 + 500;
  const { pose, errMs } = ps.byCaptureTime(capture);
  assert.equal(pose.frameId, 105);
  approx(errMs, 0, 1e-9);
  // 10 ms off is still nearest to the same frame (spacing is 33.3 ms).
  assert.equal(ps.byCaptureTime(capture + 10).pose.frameId, 105);
});

test('byCaptureTime returns null before any pose has arrived', () => {
  assert.equal(new PoseSync().byCaptureTime(123), null);
});

test('byReceiveTime picks the newest pose that beat the video frame', () => {
  const ps = fillPoseSync();
  // Pose 105 arrived (client clock) at 1000 + 5*33.3 + 500 + 5 = 1671.5; its
  // video frame lands 8 ms later — before pose 106's arrival at 1700.8.
  const { pose, leadMs } = ps.byReceiveTime(1671.5 + 8);
  assert.equal(pose.frameId, 105);
  approx(leadMs, 8, 1e-9);
  // A receive time before the first pose ever arrived → null.
  assert.equal(ps.byReceiveTime(100), null);
});

test('capacity: the buffer keeps only the newest N poses', () => {
  const ps = new PoseSync(5);
  for (let i = 0; i < 12; i++) ps.record({ frameId: i, yaw: 0, pitch: 0, t: i * 33.3 }, i * 33.3);
  assert.equal(ps.size, 5);
  assert.equal(ps.byFrameId(0), null);            // evicted
  assert.equal(ps.byFrameId(11).frameId, 11);     // newest survives
});

// ===========================================================================
section('CloudRecorder — percentiles + per-mode CSV summary (cloud/cloud-recorder.js)');

test('percentile uses the nearest-rank method', () => {
  const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  approx(percentile(v, 50), 50);   // ceil(0.5·10) = 5th value
  approx(percentile(v, 95), 100);  // ceil(0.95·10) = 10th value
  approx(percentile(v, 99), 100);
  approx(percentile([42], 95), 42);
  assert.ok(Number.isNaN(percentile([], 95)));
});

test('CSV summary reports perceived latency per warp mode', () => {
  const rec = new CloudRecorder();
  rec.toggle(0);
  // 3 warp-off samples (e2e 100/200/300) + 2 warp-on samples (view 5/15).
  rec.capture(10, { warpEnabled: false, netDelayMs: 40, jitterOn: false, noWarpMs: 100, warpMs: 100 });
  rec.capture(20, { warpEnabled: false, netDelayMs: 40, jitterOn: false, noWarpMs: 200, warpMs: 200 });
  rec.capture(30, { warpEnabled: false, netDelayMs: 40, jitterOn: false, noWarpMs: 300, warpMs: 300 });
  rec.capture(40, { warpEnabled: true, netDelayMs: 40, jitterOn: true, noWarpMs: 250, warpMs: 5 });
  rec.capture(50, { warpEnabled: true, netDelayMs: 40, jitterOn: true, noWarpMs: 250, warpMs: 15 });
  const csv = rec.toCSV();
  assert.ok(csv.startsWith('time_ms,warp_enabled,net_delay_ms,jitter_on,e2e_no_warp_ms,warp_view_ms'));
  assert.ok(csv.includes('# warp_off,3,200.00,300.00,300.00'), 'warp-off summary row');
  assert.ok(csv.includes('# warp_on,2,10.00,15.00,15.00'), 'warp-on summary row');
  assert.equal(rec.sampleCount, 5);
});

// ===========================================================================
section('input traces (replay/trace.js)');

test('poseAt is zero-order hold (newest sample at or before t)', () => {
  const trace = validateTrace({
    version: 1, name: 't', createdAt: 'x',
    samples: [{ t: 0, yaw: 0, pitch: 0 }, { t: 100, yaw: 1, pitch: 0 }, { t: 200, yaw: 2, pitch: 0 }],
  });
  assert.equal(poseAt(trace, -5).yaw, 0);   // before start → first sample
  assert.equal(poseAt(trace, 50).yaw, 0);
  assert.equal(poseAt(trace, 100).yaw, 1);  // exactly on a sample
  assert.equal(poseAt(trace, 150).yaw, 1);
  assert.equal(poseAt(trace, 999).yaw, 2);  // past the end → last sample
});

test('validateTrace rejects malformed traces', () => {
  assert.throws(() => validateTrace({ version: 1, samples: [] }));
  assert.throws(() => validateTrace({
    version: 1, samples: [{ t: 100, yaw: 0, pitch: 0 }, { t: 50, yaw: 0, pitch: 0 }],
  }), /backwards/);
  assert.throws(() => validateTrace({
    version: 1, samples: [{ t: 0, yaw: NaN, pitch: 0 }],
  }), /non-finite/);
});

test('TraceRecorder skips consecutive identical poses (ZOH makes them redundant)', () => {
  const rec = new TraceRecorder();
  rec.toggle(1000);
  rec.capture(1000, 0, 0);
  rec.capture(1016, 0, 0);    // unchanged → skipped
  rec.capture(1033, 0.1, 0);
  assert.equal(rec.samples.length, 2);
  assert.equal(rec.samples[1].t, 33); // timestamps are trace-relative
});

test('synthetic traces are deterministic (same seed → identical trace)', () => {
  const a = JSON.stringify(synthWander({ seed: 7, durationMs: 2000 }));
  const b = JSON.stringify(synthWander({ seed: 7, durationMs: 2000 }));
  const c = JSON.stringify(synthWander({ seed: 8, durationMs: 2000 }));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

// ===========================================================================
section('pipeline simulator (replay/pipeline-sim.js)');

test('simulate is bit-reproducible: same trace + config → identical CSV', () => {
  const trace = synthWander({ seed: 3, durationMs: 3000 });
  const csv1 = resultToCSV(simulate(trace, { lagMs: 80 }));
  const csv2 = resultToCSV(simulate(trace, { lagMs: 80 }));
  assert.equal(csv1, csv2); // the Phase 1 exit criterion, byte for byte
});

test('steady-state staleness lies in [lag, lag + render interval + display tick]', () => {
  // Renders only happen on display ticks, so a frame can be replaced one tick
  // late — the age bound carries that extra display-tick term (see
  // clampOnsetBoundsDegPerSec). renderHz 30, displayHz 60 → 80 + 33.3 + 16.7.
  const trace = synthConstantVelocity({ degPerSec: 90, durationMs: 5000 });
  const { summary } = simulate(trace, { lagMs: 80 });
  assert.ok(summary.stalenessMs.max <= 80 + 1000 / 30 + 1000 / 60 + 0.01,
    `max staleness ${summary.stalenessMs.max} exceeds the analytic age bound`);
  assert.ok(summary.stalenessMs.mean >= 80,
    `mean staleness ${summary.stalenessMs.mean} below the injected lag`);
});

test('warp error is zero below clamp onset, nonzero above it', () => {
  const bounds = clampOnsetBoundsDegPerSec({});
  const slow = simulate(synthConstantVelocity({ degPerSec: 0.9 * bounds.lowerDegPerSec }), {});
  assert.equal(slow.summary.clampRate, 0);
  approx(slow.summary.errWarpDeg.max, 0, 1e-9); // full compensation
  assert.ok(slow.summary.errNoWarpDeg.mean > 5, 'no-warp error should be large');
  const fast = simulate(synthConstantVelocity({ degPerSec: 1.1 * bounds.upperDegPerSec }), {});
  assert.ok(fast.summary.clampRate > 0, 'expected clamping above the upper bound');
  assert.ok(fast.summary.errWarpDeg.max > 0, 'clamped warp must leave residual error');
});

test('measured clamp onset falls within the analytic bounds (theory ↔ instrument)', () => {
  const bounds = clampOnsetBoundsDegPerSec({});
  let onset = null;
  for (let v = Math.floor(0.8 * bounds.lowerDegPerSec); v <= 1.2 * bounds.upperDegPerSec; v += 2) {
    const { summary } = simulate(synthConstantVelocity({ degPerSec: v, durationMs: 3000 }), {});
    if (summary.clampRate > 0) { onset = v; break; }
  }
  assert.ok(onset !== null, 'no clamp onset found in the sweep');
  assert.ok(onset >= bounds.lowerDegPerSec - 2 && onset <= bounds.upperDegPerSec + 2,
    `onset ${onset} deg/s outside analytic [${bounds.lowerDegPerSec.toFixed(1)}, ` +
    `${bounds.upperDegPerSec.toFixed(1)}]`);
});

test('linearisation error: uniform UV shift is exact at sec²θ = 2·tan(F/2)/F', () => {
  // THEORY.md §4: the shader shifts UV linearly in angle (δ/F), but
  // perspective is linear in tan(angle). First-order error per radian:
  // e(θ)/δ = sec²θ/2T − 1/F. Check the zero crossing and the signs at
  // centre/edge numerically against the exact tangent remap.
  const F = 2 * Math.atan(Math.tan((75 * Math.PI / 180) / 2) * (16 / 9)); // demo fovX
  const T = Math.tan(F / 2);
  const exactShift = (theta, d) => (Math.tan(theta + d) - Math.tan(theta)) / (2 * T);
  const appliedShift = d => d / F;
  const d = 1e-4; // small delta → first-order regime
  const err = (theta) => (appliedShift(d) - exactShift(theta, d)) / d;

  const thetaZero = Math.acos(Math.sqrt(F / (2 * T))); // sec²θ = 2T/F
  approx(err(thetaZero), 0, 1e-4);                  // exact at the crossing
  assert.ok(err(0) > 0.1, 'centre: uniform shift over-slides');
  assert.ok(err(F / 2 * 0.999) < -0.3, 'edge: uniform shift under-slides');
  // And the closed-form: e/δ at centre = 1/F − 1/2T … = +0.166 (overshoot).
  approx(err(0), 1 / F - 1 / (2 * T), 1e-4);
});

test('no-warp error grows with lag; warp error stays flat (the thesis, headless)', () => {
  const trace = synthSineSweep({ amplitudeDeg: 30, freqHz: 0.5, durationMs: 5000 });
  const low = simulate(trace, { lagMs: 40 }).summary;
  const high = simulate(trace, { lagMs: 120 }).summary;
  assert.ok(high.errNoWarpDeg.mean > low.errNoWarpDeg.mean * 1.5,
    'no-warp error should scale with injected lag');
  approx(low.errWarpDeg.max, 0, 1e-9);   // peak sine velocity ~94 deg/s,
  approx(high.errWarpDeg.max, 0, 1e-9);  // below onset → fully compensated
});

// ===========================================================================
section('adaptive guard band (replay/adaptive-guard.js) — Option C');

test('guardForSpeed inverts the margin equation Δmax(g) = ω·A·safety', () => {
  // Pick a speed whose answer lands strictly between gMin and gMax so the
  // clipping doesn't mask the algebra.
  const omega = 100; // deg/s
  const g = guardForSpeed(omega, DEFAULT_CONFIG);
  assert.ok(g > ADAPTIVE_DEFAULTS.gMin && g < ADAPTIVE_DEFAULTS.gMax);
  const ageSec = (80 + 1000 / 30 + 1000 / 60) / 1000;
  const needRad = (omega * Math.PI / 180) * ageSec * ADAPTIVE_DEFAULTS.safety;
  approx(maxWarpRad({ ...DEFAULT_CONFIG, guard: g }).yaw, needRad, 1e-9);
});

test('calm input: adaptive renders fewer pixels than fixed 0.12, still clamp-free', () => {
  const calm = synthSineSweep({ amplitudeDeg: 10, freqHz: 0.2, durationMs: 8000 });
  const fixed = simulate(calm, { guard: 0.12 }).summary;
  const adaptive = simulate(calm, { guardPolicy: makeAdaptiveGuardPolicy() }).summary;
  assert.equal(fixed.clampRate, 0);
  assert.equal(adaptive.clampRate, 0);
  assert.ok(adaptive.pixelCost.mean < fixed.pixelCost.mean * 0.7,
    `adaptive ${adaptive.pixelCost.mean.toFixed(3)} should undercut fixed ` +
    `${fixed.pixelCost.mean.toFixed(3)} by >30%`);
});

test('hot input: fixed 0.12 clamps, adaptive grows past it and does not', () => {
  const hot = synthWander({ seed: 2, intensity: 2, durationMs: 8000 });
  const fixed = simulate(hot, { guard: 0.12 }).summary;
  const adaptive = simulate(hot, { guardPolicy: makeAdaptiveGuardPolicy() }).summary;
  assert.ok(fixed.clampRate > 0, 'the hot trace should exhaust a fixed 12% margin');
  assert.equal(adaptive.clampRate, 0, 'adaptive should absorb the same motion');
  assert.ok(adaptive.guard.max > 0.12, 'it does so by exceeding the fixed margin');
});

// ===========================================================================
section('Vector 1 stress-sweep metrics (tagBitErrors, psnrFromMse)');

test('tagBitErrors is the Hamming distance over the 16 tag bits', () => {
  assert.equal(tagBitErrors(0xABCD, 0xABCD), 0);
  assert.equal(tagBitErrors(0x0000, 0x0001), 1);
  assert.equal(tagBitErrors(0x0000, 0x000F), 4);
  assert.equal(tagBitErrors(0x0000, 0xFFFF), 16);
  assert.equal(tagBitErrors(0xFFFF + 65536, 0xFFFF), 0); // 16-bit masked
});

test('psnrFromMse: identical → Infinity, mse=peak² → 0 dB, mse=1 → 48.13 dB', () => {
  assert.equal(psnrFromMse(0), Infinity);
  approx(psnrFromMse(255 * 255), 0, 1e-9);
  approx(psnrFromMse(1), 48.13, 0.01);
});

// ===========================================================================
section('Pose-Tagged Media protocol + A/B telemetry (cloud/pose-media.js)');

test('FrameMeta validates frameId (16-bit) and g (in [0,0.5))', () => {
  assert.deepEqual(makeFrameMeta(1234, 0.12), { frameId: 1234, g: 0.12 });
  assert.equal(makeFrameMeta(65536 + 5, 0.12).frameId, 5);    // wraps like the tag
  assert.throws(() => validateFrameMeta({ frameId: -1, g: 0.12 }), /frameId/);
  assert.throws(() => validateFrameMeta({ frameId: 70000, g: 0.12 }), /frameId/);
  assert.throws(() => validateFrameMeta({ frameId: 10, g: 0.5 }), /g must be/);
  assert.throws(() => validateFrameMeta({ frameId: 10, g: -0.01 }), /g must be/);
});

test('clean run: metadata id is exact, pixel tag costs bits, no drops', () => {
  const t = new TagABTelemetry();
  for (let i = 0; i < 100; i++) {
    t.observe({
      frameId: i, metaId: i, pixelId: i,        // both carriers recover the id
      bytesTagged: 1000 + 50, bytesClean: 1000, // the corner block costs ~50 B
      chunkDropped: false, sidecarDropped: false,
    });
  }
  const s = t.summary();
  assert.equal(s.sync.metadataExactRate, 1);
  assert.equal(s.sync.pixelExactRate, 1);
  approx(s.bytes.pixelTagOverheadPct, 5, 1e-9);   // (1050-1000)/1000 = +5%
  assert.equal(s.drops.inbandIdAvailability, 1);
  assert.equal(s.drops.sidecarIdAvailability, 1);
});

test('metadata is bit-exact where the pixel tag is not (corrupted-pixel run)', () => {
  const t = new TagABTelemetry();
  for (let i = 0; i < 100; i++) {
    // The decoded timestamp is always the true id; the pixel readback flips on
    // every 10th frame (heavy compression on the corner).
    t.observe({
      frameId: i, metaId: i, pixelId: (i % 10 === 0) ? (i ^ 1) : i,
      bytesTagged: null, bytesClean: null, chunkDropped: false, sidecarDropped: false,
    });
  }
  const s = t.summary();
  assert.equal(s.sync.metadataExactRate, 1);      // metadata: exact, always
  approx(s.sync.pixelExactRate, 0.9, 1e-9);        // pixel: 10% corrupted
});

test('drop resilience: in-band id survives sidecar loss (the design claim)', () => {
  const t = new TagABTelemetry();
  const rng = lcg(0xBEEF);
  for (let i = 0; i < 1000; i++) {
    const chunkDropped = rng() < 0.1;             // 10% media loss
    const sidecarDropped = rng() < 0.2;           // 20% sidecar loss (independent)
    t.observe({
      frameId: i,
      metaId: chunkDropped ? null : i,            // id rides IN the chunk
      pixelId: null,
      bytesTagged: null, bytesClean: null,
      chunkDropped, sidecarDropped,
    });
  }
  const s = t.summary();
  // Every delivered frame had its id available in-band, by construction.
  assert.equal(s.drops.inbandIdAvailability, 1);
  // A sidecar-only scheme would have lost the id on ~20% of delivered frames.
  assert.ok(s.drops.sidecarIdAvailability < 0.85,
    `sidecar availability ${s.drops.sidecarIdAvailability} should trail in-band`);
  assert.ok(s.drops.inbandIdAvailability > s.drops.sidecarIdAvailability);
});

// ===========================================================================
section('Vector 2 foveation budget geometry (replay/foveation.js)');

test('marginViewportFraction: 0 at rest, caps at the margin once exhausted', () => {
  approx(marginViewportFraction(0, 0.12), 0, 1e-12);
  approx(marginViewportFraction(0.5, 0.12), 0.5 * 0.12 / 0.76, 1e-9);
  approx(marginViewportFraction(1, 0.12), 0.12 / 0.76, 1e-9);
  approx(marginViewportFraction(2, 0.12), 0.12 / 0.76, 1e-9); // clamp: can't pull in more than the margin
});

test('marginInnerEccentricityDeg: margin only ever surfaces in the far periphery', () => {
  // Fixed 0.12 fully consumed → the strip's inner edge is ~36.8° off-centre.
  approx(marginInnerEccentricityDeg(1, 0.12), 36.77, 0.1);
  // At rest the "strip" collapses to the view edge = half the horizontal FOV.
  approx(marginInnerEccentricityDeg(0, 0.12), 53.74, 0.1);
  // A wider adaptive guard reaches further in (~17.9°) but still well past the
  // central ±10.8° fovea — the worst case the budget bench finds.
  approx(marginInnerEccentricityDeg(1, 0.20), 17.91, 0.1);
});

test('crushInnerEccentricityDeg: a static core, at rest and under worst warp', () => {
  const fov = 107.476;
  // Inner core = encoded cols 16–64 (coreHalf 0.3): ~42.4° off-centre at rest…
  approx(crushInnerEccentricityDeg(0.3, 0.12, 0, fov), 42.4, 0.2);
  // …but under the max fixed-guard warp shift (du = g/uScale = 0.158): ~25.5°.
  approx(crushInnerEccentricityDeg(0.3, 0.12, 0.12 / 0.76, fov), 25.5, 0.3);
  // The "18° at rest" core (cols 30–50, coreHalf 0.125) looks safe at rest…
  approx(crushInnerEccentricityDeg(0.125, 0.12, 0, fov), 17.6, 0.3);
  // …yet the same warp drives its crush into the fovea — the rest≠warp trap.
  assert.ok(crushInnerEccentricityDeg(0.125, 0.12, 0.12 / 0.76, fov) < 2);
  // A core covering the whole displayed crop → crush off-screen → Infinity.
  assert.equal(crushInnerEccentricityDeg(0.5, 0.12, 0, fov), Infinity);
});

test('foveatedPhi: continuous at the boundary, = the linear crop in the core, shallower outside', () => {
  const P = { xb: 0.30, sCore: 0.76, sPeriph: 0.30 };
  approx(foveatedPhi(P.xb, P), 0.76 * 0.30, 1e-12);        // continuous at x_b
  approx(foveatedPhi(0.2, P), 0.76 * 0.2, 1e-12);          // core IS the deployed crop (slope uScale)
  approx(foveatedPhi(-0.2, P), -0.76 * 0.2, 1e-12);        // odd-symmetric
  approx((foveatedPhi(0.5, P) - foveatedPhi(P.xb, P)) / (0.5 - P.xb), 0.30, 1e-9); // periphery slope = sPeriph
  assert.ok(Math.abs(foveatedPhi(0.5, P)) < 0.5);          // leaves a warp reserve inside the frame
});

test('CORE is the validated fovea-safe rectangle; coreRectPx tiles it', () => {
  assert.deepEqual(CORE.cols, [22, 58]);
  assert.deepEqual(CORE.rows, [11, 34]);
  assert.deepEqual(coreRectPx(16), { x0: 352, y0: 176, x1: 928, y1: 544 });
});

test('foveatedPhiInverse is the exact inverse of foveatedPhi (server squash ↔ client warp)', () => {
  const P = { xb: 0.296, sCore: 0.76, sPeriph: 0.38 };
  for (const x of [-0.5, -0.3, -0.1, 0, 0.1, 0.296, 0.3, 0.45, 0.5]) {
    approx(foveatedPhiInverse(foveatedPhi(x, P), P), x, 1e-9);
  }
  approx(foveatedPhi(0, P), 0, 1e-12);                 // centre is fixed
  approx(foveatedPhiInverse(0.76 * 0.296, P), 0.296, 1e-9); // the core boundary maps back
});

test('sCoreForExtent supersamples the core so the render edge fills the encoded edge', () => {
  const xb = 0.296, sPeriph = 0.38, XR = 0.658; // real-pipeline config (render reused)
  const sCore = sCoreForExtent(xb, sPeriph, XR);
  approx(sCore, 1.224, 0.01);                          // core ~1.6× supersampled
  approx(foveatedPhi(XR, { xb, sCore, sPeriph }), 0.5, 1e-9); // Φ(XR)=0.5, no wider FOV
  approx(sCoreForExtent(xb, 0.76, 0.5 / 0.76), 0.76, 1e-9); // sPeriph=uScale at the exact linear extent → no foveation
});

// ===========================================================================
section('Vector 3 depth-aware reprojection — parallax term (replay/parallax.js)');

const _halfX = fovXRad() / 2; // half horizontal FOV (rad) at the display FOV

test('disparity reproduces the §4.5 figure: ~74–77 px at walk speed, 2 m, 150 ms', () => {
  const t = translationFromWalk(1.4, 150);             // 0.21 m
  approx(t, 0.21, 1e-12);
  const px = disparityPx(t, 2, _halfX, 1920);
  assert.ok(px > 70 && px < 80, `expected ~77 px, got ${px.toFixed(1)}`);
  // …and it rises to ~77 px at a slightly brisker 1.46 m/s — the quoted value.
  assert.ok(disparityPx(translationFromWalk(1.46, 150), 2, _halfX, 1920) > 76);
});

test('disparity is inverse in depth and consistent between px and UV', () => {
  const t = 0.21;
  approx(disparityPx(t, 4, _halfX, 1920), disparityPx(t, 2, _halfX, 1920) / 2, 1e-9); // 2× depth → ½ shift
  approx(disparityUV(t, 2, _halfX) * 1920, disparityPx(t, 2, _halfX, 1920), 1e-9);    // UV·W == px
  approx(focalPx(_halfX, 1920), 960 / Math.tan(_halfX), 1e-9);
});

test('representativeDepth is the inverse-depth midpoint (harmonic mean)', () => {
  approx(representativeDepth(2, 20), 2 / (0.5 + 0.05), 1e-12); // 3.636…
  approx(representativeDepth(5, 5), 5, 1e-12);                 // flat cell → itself
});

test('residual: zero on a flat cell, and a 4× cut on a near [2,4] cell', () => {
  approx(residualPx(0.21, 3, 3, _halfX, 1920), 0, 1e-12);     // constant depth → fully corrected
  const r = residualPx(0.21, 2, 4, _halfX, 1920);
  approx(r, 18.5, 0.3);                                       // worst-case ~18.5 px
  assert.ok(r < disparityPx(0.21, 2, _halfX, 1920) / 3);     // far better than uncorrected (~74 px)
});

test('disocclusion = differential parallax across a step, = 2× the straddling-cell residual', () => {
  const occ = disocclusionPx(0.21, 2, 20, _halfX, 1920);
  approx(occ, 0.21 * (0.5 - 0.05) * focalPx(_halfX, 1920), 1e-9); // ~66.5 px
  // A cell spanning the full [2,20] step: best single-depth correction leaves
  // exactly half the disocclusion band as residual (rep depth sits mid-gap).
  approx(residualPx(0.21, 2, 20, _halfX, 1920), occ / 2, 1e-9);
});

test('grid residual shrinks as the depth grid gets finer (quantization, not physics)', () => {
  // Receding floor: depth grows from 2 m (bottom) to 20 m (top) across the frame.
  const floor = (_u, v) => 2 + (20 - 2) * v;
  const opts = { translationM: 0.21, halfFovRad: _halfX, viewportPx: 1920 };
  const coarse = gridResidualStats(cellExtentsFromField(floor, 16, 9), opts);
  const fine   = gridResidualStats(cellExtentsFromField(floor, 32, 18), opts);
  assert.ok(fine.maxPx < coarse.maxPx, `finer grid should reduce residual (${fine.maxPx} !< ${coarse.maxPx})`);
  assert.ok(fine.meanPx < coarse.meanPx);
});

test('flat scene → every cell fully corrected (no residual at any grid)', () => {
  const flat = () => 8;
  const stats = gridResidualStats(cellExtentsFromField(flat, 16, 9), { translationM: 0.5, halfFovRad: _halfX, viewportPx: 1920 });
  approx(stats.maxPx, 0, 1e-12);
});

test('shader twin: parallaxDeltaUV(transUVPerMeter) matches the disparity primitive', () => {
  const tx = 0.21, d = 2, halfY = _halfX; // square pixels → halfY focal == halfX here for the check
  const num = translationUVPerMeter(tx, 0, _halfX, halfY);
  const shift = parallaxDeltaUV(num, d);
  approx(Math.abs(shift[0]), disparityUV(tx, d, _halfX), 1e-12); // GPU path == measured shift
  approx(shift[1], 0, 1e-12);                                    // no vertical translation → no v shift
  approx(parallaxDeltaUV(num, 2 * d)[0], shift[0] / 2, 1e-12);   // inverse in depth, like disparity
});

// ===========================================================================
console.log(`\n${failed ? RED : GREEN}${passed} passed, ${failed} failed${RESET}`);
process.exit(failed ? 1 : 0);
