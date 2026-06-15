/* ---------------------------------------------------------------------------
   foveation-demo.js — Vector 2 visual proof: the foveation round-trip
   ---------------------------------------------------------------------------
   Two GLSL passes (foveation-shader.js) on a readable grid test pattern:
     pass 1  SQUASH    wide render → encoded frame (periphery squashed)
     pass 2  DISPLAY   encoded frame → view, reconstructed via Φ(vUv+uDelta)

   Toggle modes to SEE it: 1 = reconstructed, 2 = the encoded frame (watch the
   periphery squashed toward the edges), 3 = full-res same view (A/B). Flip 1↔3
   and the CORE rectangle is identical (clean round-trip) while the periphery
   softens. The warp slider slides the view and pulls from the reserve.

   Parameters come straight from the locked spec: core = CORE (22-58 × 11-34 MB),
   sCore = 0.76 (core unchanged), sPeriph = 0.38 (the ΔR-measured knob).

   NOT run by its author (no WebGL here). The GLSL Φ matches the Node-tested
   foveatedPhi/Inverse; the THREE plumbing is the unverified part.
--------------------------------------------------------------------------- */

import * as THREE from 'three';
import { createSquashMaterial, createDisplayMaterial } from './foveation-shader.js';
import { CORE, foveatedPhiInverse } from './replay/foveation.js';

const W = 1280, H = 720;

// Display core half-widths (centre-relative) from the locked MB core: the core
// spans encoded ±(MB half / grid); divide by sCore to get the DISPLAY half.
let sCore = 0.76, sPeriph = 0.38, warpX = 0, mode = 0;
const xbX = ((CORE.cols[1] - CORE.cols[0]) / 2 / CORE.mbCols) / sCore; // ≈ 0.296
const xbY = ((CORE.rows[1] - CORE.rows[0]) / 2 / CORE.mbRows) / sCore; // ≈ 0.336

// --- a readable test pattern: grid + labels + fine hatch (resolution shows) ---
function makeTestPattern() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#f4f6fb'; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(40,60,90,0.22)'; x.lineWidth = 1;          // fine diagonal hatch
  for (let i = -H; i < W; i += 6) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + H, H); x.stroke(); }
  x.strokeStyle = 'rgba(20,30,50,0.45)';                          // 32px grid
  for (let gx = 0; gx <= W; gx += 32) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, H); x.stroke(); }
  for (let gy = 0; gy <= H; gy += 32) { x.beginPath(); x.moveTo(0, gy); x.lineTo(W, gy); x.stroke(); }
  x.strokeStyle = '#1b3a6b'; x.lineWidth = 2; x.fillStyle = '#1b3a6b'; x.font = 'bold 14px monospace';
  for (let gx = 0; gx <= W; gx += 128) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, H); x.stroke(); }
  for (let gy = 0; gy <= H; gy += 128) { x.beginPath(); x.moveTo(0, gy); x.lineTo(W, gy); x.stroke(); }
  for (let gx = 0; gx < W; gx += 128) for (let gy = 0; gy < H; gy += 128) x.fillText(`${gx / 128},${gy / 128}`, gx + 4, gy + 16);
  x.strokeStyle = '#c0392b'; x.lineWidth = 3; x.strokeRect(W / 2 - 60, H / 2 - 60, 120, 120); // centre
  return c;
}

const testTex = new THREE.CanvasTexture(makeTestPattern());
testTex.colorSpace = THREE.SRGBColorSpace;
testTex.generateMipmaps = true;
testTex.minFilter = THREE.LinearMipmapLinearFilter; // antialias the squash downsample
testTex.magFilter = THREE.LinearFilter;
testTex.needsUpdate = true;

// --- renderer + fullscreen quad + intermediate "encoded" target --------------
const canvas = document.getElementById('fov-view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);

const scene = new THREE.Scene();
const cam = new THREE.Camera();
const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
mesh.frustumCulled = false;
scene.add(mesh);

const rt = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

const squashMat = createSquashMaterial();
const displayMat = createDisplayMaterial();
squashMat.uniforms.tInput.value = testTex;
displayMat.uniforms.tInput.value = testTex;

function uDeltaMax(xb) { return (0.5 - sCore * xb) / sPeriph - (0.5 - xb); }

function applyParams() {
  const XRx = foveatedPhiInverse(0.5, { xb: xbX, sCore, sPeriph });
  const XRy = foveatedPhiInverse(0.5, { xb: xbY, sCore, sPeriph });
  for (const m of [squashMat, displayMat]) {
    m.uniforms.uXb.value.set(xbX, xbY);
    m.uniforms.uSCore.value = sCore;
    m.uniforms.uSPeriph.value = sPeriph;
    m.uniforms.uXR.value.set(XRx, XRy);
  }
  displayMat.uniforms.uDelta.value.set(warpX, 0);
  displayMat.uniforms.uMode.value = mode;

  const max = uDeltaMax(xbX);
  const clamped = Math.abs(warpX) > max;
  const modeName = ['reconstructed (Φ round-trip + warp)', 'encoded frame (periphery squashed)', 'full-res — same view (A/B)'][mode];
  setText('fov-readout',
    `mode ${mode + 1}: ${modeName}  ·  S_periph ${sPeriph.toFixed(2)}  ·  warp ${warpX.toFixed(2)}` +
    `  ·  reserve ±${max.toFixed(2)}${clamped ? ' — EXCEEDED → edge clamp' : ''}`);
}

function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }

function tick() {
  requestAnimationFrame(tick);
  mesh.material = squashMat;                 // pass 1 → encoded
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(null);
  displayMat.uniforms.tEncoded.value = rt.texture;
  mesh.material = displayMat;                // pass 2 → screen
  renderer.render(scene, cam);
}

// --- controls ----------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.key === '1') mode = 0; else if (e.key === '2') mode = 1; else if (e.key === '3') mode = 2; else return;
  applyParams();
});
function wire(id, set) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => { set(parseFloat(el.value)); applyParams(); });
}
wire('sl-speriph', (v) => { sPeriph = v; });
wire('sl-warp', (v) => { warpX = v; });
document.querySelectorAll('[data-mode]').forEach((b) =>
  b.addEventListener('click', () => { mode = parseInt(b.dataset.mode, 10); applyParams(); }));

applyParams();
tick();
console.log('[Foveation] keys 1/2/3 = reconstructed / encoded / full-res A/B; sliders below.');
