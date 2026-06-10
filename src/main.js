/* ---------------------------------------------------------------------------
   main.js — Entry point: wires everything together and runs the render loop
   ---------------------------------------------------------------------------
   STAGE 2 pipeline (read the modules first, then this conductor):

       input.js   (fast clock)  ──┐
       lag.js     (slow clock)  ──┤
       scene.js   (the world)   ──┤
       warp-target.js (RT)      ──┼─► loop ─► [30 FPS] render scene → texture
       quad-render.js (quad)    ──┤          [display rate] warp texture → screen
       warp-shader.js (math)    ──┘                         + hud.js (stats)

   Rendering happens in TWO phases at TWO different rates, onto a single
   fullscreen viewport:
     • SLOW (30 FPS): draw the 3D scene into an off-screen texture.
     • FAST (display rate, 60/120/165 Hz): draw that texture to the screen,
       reprojected to follow the freshest mouse input when warp is on. 'W'
       toggles the warp; the scoreboard compares accuracy with vs without it.
--------------------------------------------------------------------------- */

import * as THREE from 'three';
import { createScene } from './scene.js';
import { Input } from './input.js';
import { LagSim } from './lag.js';
import { HUD, Scoreboard } from './hud.js';
import { WarpTarget } from './warp-target.js';
import { QuadRenderer } from './quad-render.js';
import { Latency } from './latency.js';
import { LatencyChart } from './chart.js';
import { Recorder } from './recorder.js';
import { Targets } from './targets.js';
import { VelocityPass } from './velocity-pass.js';
import { renderFovDeg } from './projection.js';
import { createShooter } from './shooter.js';
import { installControls } from './controls.js';
import { TraceRecorder } from './replay/trace.js';

// --- Display / guard-band geometry constants -------------------------------
// The FOV the user actually sees. The scene is rendered WIDER than this so the
// warp has a margin of real pixels to pull from (see warp-shader.js). This is
// the same idea as Oculus ATW / VR reprojection render margins.
//
// GUARD is the margin as a fraction of the TEXTURE (0.12 => the displayed crop
// is the central 76%). Equivalent VR-style "margin relative to display" m would
// be m = GUARD/(1-2*GUARD) ≈ 0.158.
//
// The render FOV uses the TANGENT-exact crop relationship — perspective is
// linear in tan(angle), not angle — so the central crop is exactly DISPLAY_FOV_Y.
// (The linear approximation render_FOV = display_FOV*(1+2m) would leave a subtle
// framing mismatch at this FOV.)
//
// Trade-off for the report: the 12% margin is tuned for typical gaming
// sensitivity; pathological input velocities can exhaust it in one frame and
// fall back to edge clamping. It also costs GPU (we render more than we show).
const DISPLAY_FOV_Y = 75;          // degrees (constant — what the user sees)
let guard = 0.12;                  // guard-band margin per side, texture-relative
let uvScale = 1 - 2 * guard;       // fraction of the texture we display (0.76)

// Wider render FOV whose central uvScale crop equals DISPLAY_FOV_Y — the
// tangent-exact relationship lives in projection.js (pure + unit-tested).

// --- Capability check ------------------------------------------------------
// This demo needs WebGL and a mouse (pointer lock). Fail loudly and politely
// rather than crashing with a cryptic error on an unsupported device.
function showUnsupported(message) {
  const overlay = document.getElementById('overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.style.cursor = 'default';
    overlay.innerHTML =
      `<div class="overlay-card"><h1>Frame Warp</h1>` +
      `<p>${message}</p>` +
      `<p class="hint">Open it on a desktop browser (Chrome/Edge/Firefox) with WebGL enabled.</p></div>`;
  }
}
function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) {
    return false;
  }
}
if (!webglAvailable()) {
  showUnsupported('This demo requires WebGL, which your browser/device doesn’t support.');
  throw new Error('[FrameWarp] WebGL unavailable — halting.');
}

// --- Renderer --------------------------------------------------------------
const canvas = document.getElementById('view');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (e) {
  showUnsupported('Could not create a WebGL context.');
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.autoClear = true;

// --- World -----------------------------------------------------------------
const world = createScene();

// The scene camera. Aspect is set to the full window in resize(). It renders at
// the WIDER guard-band FOV; the shader crops back to the display FOV.
const camera = new THREE.PerspectiveCamera(renderFovDeg(DISPLAY_FOV_Y, uvScale), 1, 0.1, 200);
camera.position.set(0, 1.7, 0);

// --- Subsystems ------------------------------------------------------------
const input = new Input(canvas);
const lag = new LagSim(30, 80);           // 30 FPS source cap, +80ms pipeline lag
const hud = new HUD();
const warpTarget = new WarpTarget(1, 1);  // sized properly in resize()
const quad = new QuadRenderer();
quad.setGuard(guard);
const velocityPass = new VelocityPass();
const latency = new Latency();
const chart = new LatencyChart(document.getElementById('latency-chart'));
const recorder = new Recorder();
const traceRecorder = new TraceRecorder(); // input traces for the replay system ('T')

// Shooter: moving targets added into the scene, plus the score overlay.
const targets = new Targets(world.range);
world.scene.add(targets.group);
const scoreboard = new Scoreboard();
scoreboard.setActiveMode(false); // demo starts in the "problem" state (warp off)

// The ONLY toggle the user touches. Starts OFF so the demo opens in the
// "problem" state (laggy, missing), then 'W' turns Frame Warp on.
let warpEnabled = false;

// Demo mode hides all the technical readouts and enlarges the score (for
// non-technical judges). Toggle with 'D'.
let demoMode = false;

// Motion vectors: the third layer. When OFF, the velocity buffer is ignored and
// the moving target judders at the 30 FPS source rate. When ON, the velocity
// pass runs and the warp shader smooths object motion to display rate. Toggle 'M'.
let motionVectorsOn = false;

// Wall-clock time (ms) of the most recent 30 FPS render — the velocity warp
// extrapolates object motion forward by (now - this) seconds.
let lastRenderWallTime = performance.now();

// Slow-motion debug mode (Shift+M): drops the source rate to 10 FPS so the
// motion-vector effect (judder → smooth) is unmistakable. Restores on toggle.
let slowMo = false;

// The elapsed time (scene clock) at the most recent 30 FPS render tick.
// Used by the shooter to restore target positions after real-time hit testing.
let lastRenderedElapsed = 0;

// --- Pointer-lock overlay --------------------------------------------------
const overlay = document.getElementById('overlay');
overlay.addEventListener('click', () => input.lock());
document.addEventListener('pointerlockchange', () => {
  overlay.classList.toggle('hidden', input.locked);
});

// (Shooting lives in shooter.js; keyboard + the recording indicator live in
//  controls.js. Both are wired up below, after the state they touch exists.)

// --- Resize handling -------------------------------------------------------
let fullW = 1, fullH = 1;
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);

  fullW = w;
  fullH = h;

  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  // Size the render target so the DISPLAYED crop keeps the drawing-buffer
  // resolution — then divide by UV_SCALE to add the guard-band margin as extra
  // real texels (so the guard band doesn't cost displayed sharpness).
  const pr = renderer.getPixelRatio();
  warpTarget.setSize(
    Math.ceil((w * pr) / uvScale),
    Math.ceil((h * pr) / uvScale)
  );
  // Keep the de-ghost neighborhood step at one texel of the scene texture.
  quad.setTexelSize(warpTarget.rt.width, warpTarget.rt.height);
}
window.addEventListener('resize', resize);
resize();

// --- Runtime guard-band change (from the parameter panel) ------------------
function applyGuard(pct) {
  guard = pct / 100;
  uvScale = 1 - 2 * guard;
  camera.fov = renderFovDeg(DISPLAY_FOV_Y, uvScale);
  camera.updateProjectionMatrix();
  quad.setGuard(guard);
  resize(); // re-sizes the render target for the new margin
}

// --- Parameter panel: live sliders for lag, source rate, guard band --------
function wireSlider(sliderId, valueId, onChange, fmt = (v) => v) {
  const slider = document.getElementById(sliderId);
  const label = document.getElementById(valueId);
  const update = () => {
    const v = parseFloat(slider.value);
    label.textContent = fmt(v);
    onChange(v);
  };
  slider.addEventListener('input', update);
  update(); // initialize from default
}
wireSlider('sl-lag', 'val-lag', (v) => { lag.lagMs = v; });
wireSlider('sl-hz', 'val-hz', (v) => { lag.setRenderHz(v); });
wireSlider('sl-guard', 'val-guard', (v) => { applyGuard(v); });

// Warp drives the injected lag so the contrast is unmistakable without the judge
// having to be a skilled tracker: warp OFF → a clearly-broken 150 ms, warp ON →
// a crisp 50 ms, applied immediately. Driving the slider keeps the panel label,
// the HUD and the LagSim all in sync.
const _slLag = document.getElementById('sl-lag');
function applyWarpLag() {
  _slLag.value = warpEnabled ? '50' : '150';
  _slLag.dispatchEvent(new Event('input', { bubbles: true }));
  // The HUD text only flushes at ~1 Hz; reflect the new lag immediately too.
  document.getElementById('hud-lag').textContent = _slLag.value + ' ms';
}
applyWarpLag(); // initialise: warp starts off → 150 ms

// --- Orientation helper ----------------------------------------------------
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
function setCameraOrientation(yaw, pitch) {
  _euler.set(pitch, yaw, 0);
  camera.quaternion.setFromEuler(_euler);
}

// --- The main loop ---------------------------------------------------------
const clock = new THREE.Clock();

// Wire up shooting and controls. They read/write the app state through these
// accessors, so this file keeps owning the state and the loop is untouched.
const shooter = createShooter({
  input, warpTarget, targets, camera, scoreboard, clock,
  getWarpEnabled: () => warpEnabled,
  getMotionVectorsOn: () => motionVectorsOn,
  getLastRenderedElapsed: () => lastRenderedElapsed,
  getLastRenderWallTime: () => lastRenderWallTime,
});
const controls = installControls({
  scoreboard, recorder, traceRecorder, applyWarpLag,
  getWarpEnabled: () => warpEnabled, setWarpEnabled: (v) => { warpEnabled = v; },
  getMotionVectorsOn: () => motionVectorsOn, setMotionVectorsOn: (v) => { motionVectorsOn = v; },
  getDemoMode: () => demoMode, setDemoMode: (v) => { demoMode = v; },
  getSlowMo: () => slowMo, setSlowMo: (v) => { slowMo = v; },
});

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();

  // 1) FAST CLOCK: capture freshest input every tick.
  hud.addInputEvents(input.drainEventCount());
  const snap = input.snapshot();
  lag.record(now, snap);
  traceRecorder.capture(now, snap.yaw, snap.pitch); // no-op unless recording
  const elapsed = clock.getElapsedTime();
  world.update(elapsed);

  // 2) SLOW CLOCK (≤30 FPS): render the 3D scene into the off-screen texture,
  //    using the deliberately-delayed orientation, and remember that orientation.
  if (lag.shouldRender(now)) {
    const o = lag.orientationToRender(now);
    setCameraOrientation(o.yaw, o.pitch);
    warpTarget.renderedYaw = o.yaw;
    warpTarget.renderedPitch = o.pitch;
    // Record the real input timestamp this frame reflects (for measured latency).
    latency.markRender(o.t);

    // Lag the target positions by the same amount as the camera orientation.
    // In a real pipeline the ENTIRE frame is old — both the view direction and
    // the world state are from lagMs ago. This makes the displayed target
    // position genuinely stale, so the user aims at where the target WAS.
    const laggedElapsed = Math.max(0, elapsed - lag.lagMs / 1000);
    lastRenderedElapsed = laggedElapsed;
    targets.update(laggedElapsed);

    renderer.setScissorTest(false);
    renderer.setRenderTarget(warpTarget.rt);
    renderer.render(world.scene, camera);
    renderer.setRenderTarget(null);

    // Motion-vector pass: write each target's screen velocity into the velocity
    // buffer (same camera, same 30 FPS). Only when enabled — otherwise the warp
    // shader ignores it anyway. Targets are already at their lagged positions
    // and their velocities were stored by the update() above.
    if (motionVectorsOn) {
      velocityPass.render(renderer, warpTarget.velocityRT, camera, targets.meshes, targets.getVelocities());
    }
    lastRenderWallTime = now; // the buffers are now "fresh" as of this tick

    hud.countSceneFrame();
  }

  // 3) FAST CLOCK (display rate): composite the texture to the screen.
  //    Compute how far the camera has rotated SINCE the frame was rendered, and
  //    convert that angular motion into a texture-space shift via the FOV.
  const fresh = input.snapshot();
  const dYaw   = fresh.yaw   - warpTarget.renderedYaw;
  const dPitch = fresh.pitch - warpTarget.renderedPitch;

  // Use the DISPLAY FOV (not the wider render FOV) — the shift is in the units
  // of what the user sees; the shader scales it into the guard-banded texture.
  const fovY = THREE.MathUtils.degToRad(DISPLAY_FOV_Y);
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * camera.aspect);

  // UV shift. Signs chosen so the image slides to track the new view direction.
  const du = -dYaw / fovX;
  const dv =  dPitch / fovY;

  // Single fullscreen viewport. Warp ON reprojects toward the freshest input;
  // warp OFF shows the raw lagged frame (zero shift). The motion-vector inputs
  // smooth moving objects per-pixel when enabled (dt = age of the source frame).
  const delta = warpEnabled ? [du, dv] : [0, 0];
  const mv = {
    texture: warpTarget.velocityTexture,
    dtSeconds: Math.max(0, (now - lastRenderWallTime) / 1000),
    enabled: motionVectorsOn,
  };
  quad.render(renderer, warpTarget.texture, delta, fullW, fullH, mv);

  hud.countCompositeFrame();

  // 4) Measure latency from real timestamps, then record / display.
  const lat = latency.sample(now, warpEnabled);
  recorder.capture(now, {
    warpEnabled,
    injectedLagMs: lag.lagMs,
    sourceHz: 1000 / lag.renderInterval,
    guardPct: guard * 100,
    noWarpMs: lat.noWarp,
    warpMs: lat.warp,
  });
  chart.draw(now, latency.noWarp, latency.warp);
  hud.update(now, {
    warpEnabled,
    motionVectorsOn,
    injectedLagMs: lag.lagMs,
    noWarpMs: latency.smoothNoWarp,
    warpMs: latency.smoothWarp,
  });
  if (recorder.recording) controls.updateRecIndicator(); // live sample count
}

frame();

// Debug namespace — exposed only with ?debug in the URL, so the shipped demo
// doesn't leak internals to the console (or pin the module graph in memory).
if (new URLSearchParams(location.search).has('debug')) {
  window.FrameWarp = { renderer, camera, world, input, lag, warpTarget, quad, latency, recorder,
    traceRecorder, targets, scoreboard, velocityPass, fire: shooter.fire,
    get warpEnabled() { return warpEnabled; }, set warpEnabled(v) { warpEnabled = v; },
    get motionVectorsOn() { return motionVectorsOn; }, set motionVectorsOn(v) { motionVectorsOn = v; },
    get guard() { return guard; } };
  console.log('[FrameWarp] debug namespace exposed as window.FrameWarp');
}
console.log('[FrameWarp] ready. Click to enter & shoot. Keys: W=warp M=motion-vectors (Shift+M=slow-mo) R=record E=export T=input-trace D=demo-mode.');
