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
console.log(`\n${failed ? RED : GREEN}${passed} passed, ${failed} failed${RESET}`);
process.exit(failed ? 1 : 0);
