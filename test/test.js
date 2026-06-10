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
console.log(`\n${failed ? RED : GREEN}${passed} passed, ${failed} failed${RESET}`);
process.exit(failed ? 1 : 0);
