/* ---------------------------------------------------------------------------
   test/smoke-ui.mjs — Headless runtime smoke test for the v2 UI modules
   ---------------------------------------------------------------------------
   node --check only proves the files PARSE. This stubs a minimal DOM + Web Audio
   so we can actually IMPORT and INVOKE the new browser modules in Node, catching
   wiring bugs (bad method calls, missing returns, null refs) without a browser.

   It only covers the THREE-free modules (the ones with real branching logic):
   audio, warp-flash, onboarding, summary, feel-the-lag, permalink, hud, chart.
   Run with:  node test/smoke-ui.mjs
--------------------------------------------------------------------------- */

// --- Minimal DOM ------------------------------------------------------------
const ctx2d = new Proxy(
  { createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 0 }) },
  { get: (t, p) => (p in t ? t[p] : () => {}), set: () => true },
);

function makeEl() {
  const target = {
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {}, dataset: {}, value: '', textContent: '', innerHTML: '', offsetWidth: 0,
    width: 280, height: 120,
    getContext: () => ctx2d,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    dispatchEvent: () => true,
  };
  const el = new Proxy(target, {
    get: (t, p) => (p in t ? t[p] : () => {}),
    set: (t, p, v) => { t[p] = v; return true; },
  });
  target.querySelector = () => el;
  return el;
}

const els = {};
globalThis.document = {
  getElementById: (id) => (els[id] ||= makeEl()),
  createElement: () => makeEl(),
  body: makeEl(),
  addEventListener() {},
};

// --- Minimal window + event hub --------------------------------------------
const listeners = {};
globalThis.window = {
  addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
  removeEventListener() {},
  dispatchEvent: (e) => { (listeners[e.type] || []).forEach((fn) => fn(e)); return true; },
};
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.requestAnimationFrame = () => 1; // do NOT auto-run (avoids ramp loops)
globalThis.cancelAnimationFrame = () => {};
globalThis.location = { hash: '#lag=120&hz=20&guard=18', search: '' };
globalThis.history = { replaceState() {} };

// --- Minimal Web Audio ------------------------------------------------------
const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
const node = () => ({ connect: (n) => n, start() {}, stop() {}, gain: param(), frequency: param(), Q: param(), type: '', buffer: null });
globalThis.window.AudioContext = class {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = {}; }
  createGain() { return node(); }
  createOscillator() { return node(); }
  createBiquadFilter() { return node(); }
  createBufferSource() { return node(); }
  createBuffer() { return { getChannelData: () => new Float32Array(16) }; }
  resume() {}
};

// --- Tiny assert harness ----------------------------------------------------
let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); fail++; }
}

// --- The checks -------------------------------------------------------------
const { Audio } = await import('../src/audio.js');
ok('audio: construct, resume, all cues, mute', () => {
  const a = new Audio();
  a.resume(); a.resume();              // idempotent
  a.fire(); a.hit(); a.miss(); a.warpOn(); a.warpOff();
  if (a.toggleMute() !== true) throw new Error('toggleMute should report muted=true');
  a.fire(); // muted path must not throw
});

const { announceWarp } = await import('../src/warp-flash.js');
ok('warp-flash: announce on/off', () => { announceWarp(true); announceWarp(false); });

const { installOnboarding } = await import('../src/onboarding.js');
ok('onboarding: start + drives through shot/warp events', () => {
  const ob = installOnboarding();
  ob.start();
  for (let i = 0; i < 6; i++) window.dispatchEvent(new CustomEvent('framewarp:shot', { detail: { hit: false, warpOn: false } }));
  window.dispatchEvent(new CustomEvent('framewarp:warp', { detail: { on: true } }));
  for (let i = 0; i < 5; i++) window.dispatchEvent(new CustomEvent('framewarp:shot', { detail: { hit: true, warpOn: true } }));
});

const { installSummary } = await import('../src/summary.js');
ok('summary: show with data, hide', () => {
  let relocked = false;
  const s = installSummary({
    getData: () => ({ off: { hits: 3, misses: 7 }, on: { hits: 9, misses: 1 }, latNoWarp: 150, latWarp: 16 }),
    relock: () => { relocked = true; },
  });
  s.show(); s.hide();
});
ok('summary: no shots → no-op show', () => {
  const s = installSummary({ getData: () => ({ off: { hits: 0, misses: 0 }, on: { hits: 0, misses: 0 } }), relock() {} });
  s.show();
});

const { installFeelTheLag } = await import('../src/feel-the-lag.js');
ok('feel-the-lag: toggle start + cancel', () => {
  let warp = false;
  const f = installFeelTheLag({ setWarp: (v) => { warp = v; }, getWarpEnabled: () => warp, audio: new Audio() });
  f.toggle(); // start
  f.toggle(); // cancel
});

const { installPermalink } = await import('../src/permalink.js');
ok('permalink: applies hash to sliders', () => {
  installPermalink({ lag: 'sl-lag', hz: 'sl-hz', guard: 'sl-guard' });
  if (els['sl-lag'].value !== '120') throw new Error('expected sl-lag=120 from hash, got ' + els['sl-lag'].value);
});

const { Scoreboard, HUD } = await import('../src/hud.js');
ok('hud: Scoreboard register/active/snapshot/reset', () => {
  const sb = new Scoreboard();
  sb.registerShot(false, false);
  sb.registerShot(true, true);
  sb.setActiveMode(true);
  const snap = sb.snapshot();
  if (snap.on.hits !== 1 || snap.off.misses !== 1) throw new Error('snapshot tally wrong: ' + JSON.stringify(snap));
  sb.reset();
  if (sb.snapshot().on.hits !== 0) throw new Error('reset did not clear');
});
ok('hud: HUD.update flushes after 1s', () => {
  const h = new HUD();
  h.countSceneFrame(); h.countCompositeFrame(); h.addInputEvents(3);
  h._lastFlush = performance.now() - 1100; // force a flush
  h.update(performance.now(), { warpEnabled: true, motionVectorsOn: false, injectedLagMs: 50, noWarpMs: 150, warpMs: 16 });
});

const { LatencyChart } = await import('../src/chart.js');
ok('chart: draw series + toggle markers + annotations', () => {
  const c = new LatencyChart(makeEl());
  const series = Array.from({ length: 40 }, (_, i) => 20 + i);
  c._lastDraw = performance.now() - 100; // bypass the 33ms throttle
  c.draw(performance.now(), series, series, [{ x: 0.5, on: true }, { x: 1.2, on: false }]);
});

const { AccuracyChart } = await import('../src/accuracy-chart.js');
ok('accuracy-chart: record both modes + draw + reset', () => {
  const c = new AccuracyChart(makeEl(), { window: 4 });
  c.record(false, false); c.record(false, true);
  c.record(true, true); c.record(true, true);
  c._lastDraw = performance.now() - 100; // bypass the 33ms throttle
  c.draw(performance.now());
  c.reset();
  if (c.series.on.length !== 0) throw new Error('reset did not clear series');
});

const { installHeatmap } = await import('../src/heatmap.js');
ok('heatmap: toggle + update collapses with warp on', () => {
  const h = installHeatmap();
  h.update({ yaw: 0.2, pitch: 0 }, { yaw: 0.1, pitch: 0 }, false); // hidden → no-op
  if (h.visible() !== false) throw new Error('should start hidden');
  h.toggle();
  h.update({ yaw: 0.2, pitch: 0 }, { yaw: 0.1, pitch: 0 }, false);  // warp off → gap
  h.update({ yaw: 0.2, pitch: 0 }, { yaw: 0.2, pitch: 0 }, true);   // warp on → no gap
  if (h.visible() !== true) throw new Error('should be visible after toggle');
  h.toggle();
});

const { installABTest } = await import('../src/abtest.js');
ok('abtest: off/on blocks drive to replay, then close', () => {
  let warp = false;
  const ab = installABTest({ setWarp: (v) => { warp = v; }, getWarpEnabled: () => warp, relock() {} });
  ab.toggle(); // start the WARP-OFF block
  const shot = (warpOn, hit) => window.dispatchEvent(new CustomEvent('framewarp:shot', {
    detail: { hit, warpOn, aim: { displayed: { x: 0.02, y: 0.01 }, actual: { x: 0.12, y: 0.03 }, errDeg: 5.2 } },
  }));
  for (let i = 0; i < 8; i++) shot(false, false); // fills OFF block → switches to ON
  for (let i = 0; i < 8; i++) shot(true, true);   // fills ON block → finish → replay
  if (!ab.isActive()) throw new Error('expected replay phase active');
  ab.toggle(); // close
  if (ab.isActive()) throw new Error('expected closed after toggle');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
