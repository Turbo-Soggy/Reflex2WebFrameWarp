/* ---------------------------------------------------------------------------
   chapters.js — Scenario chapters on the number keys (Presenter plan, Phase 3)
   ---------------------------------------------------------------------------
   The vendor-tech-demo spine: in presenter mode, 1 plays a scenario, 2 plays
   the next, and so on. Each chapter is a FULL, idempotent preset of every
   knob the demo has (warp, source Hz, guard %, motion vectors, view, freeze,
   zone tint, autopilot mode, ghost reticle, heat map, charts), plus a
   lower-third caption and a "you are here" strip. Jumping 7 → 2 → 7 lands on
   identical state because every chapter writes every field, after a reset of
   the stateful views (autopilot stopped, unfrozen, normal view, zones off).

   Keys (e.code, so layouts and the numpad row agree):
     Digit1..Digit9        jump to that chapter (turns presenter mode on first)
     PageDown / ArrowRight next chapter        (clicker-friendly)
     PageUp   / ArrowLeft  previous chapter
     Digit0                reset the scores (scoreboard + hit-rate chart)
   Escape is NOT a chapter key: it belongs to pointer lock.

   Injected lag is deliberately NOT a chapter field that is written by default:
   main.js setWarp() couples it to the warp state (a user decision). The `lag`
   field is null ("leave as-is") in every preset; a number would drive the
   Injected-lag slider after setWarp.

   The table and applyPreset() are pure (no DOM at import time) so test/test.js
   can check them in Node with a fake system object.
--------------------------------------------------------------------------- */

/* Autopilot presets. Every chapter sets ALL five options so a sine amplitude
   from one chapter can never leak into the next. 'track' follows the target;
   'sine' is a known sweep whose speed decides how much guard band is used. */
const TRACK = { mode: 'track', amplitude: 0.42, pitchAmplitude: 0.06, period: 3.6, smoothing: 0.08 };
// X-ray: a moderate sweep, so the crop slides visibly but stays inside the texture.
const XRAY_SWEEP = { mode: 'sine', amplitude: 0.3, pitchAmplitude: 0.04, period: 2.0, smoothing: 0.08 };
// Freeze: a small sweep around the frozen frame's direction (inside the margin).
const FREEZE_SWEEP = { mode: 'sine', amplitude: 0.12, pitchAmplitude: 0.03, period: 3.0, smoothing: 0.08 };
// Guard-band limits: a large, fast sweep so the shift outruns the margin.
const FLICK_SWEEP = { mode: 'sine', amplitude: 0.9, pitchAmplitude: 0.12, period: 2.0, smoothing: 0.08 };

/** Every field a preset must define (the unit test checks each one). */
export const PRESET_FIELDS = [
  'key', 'short', 'title', 'sub',
  'warp', 'hz', 'guard', 'lag', 'mv',
  'view', 'frozen', 'zones',
  'autopilot', 'ghost', 'heatmap', 'charts',
];

const base = {
  warp: true, hz: 30, guard: 12, lag: null, mv: false,
  view: 'normal', frozen: false, zones: false,
  autopilot: TRACK, ghost: false, heatmap: false, charts: false,
};

export const CHAPTERS = [
  { ...base, key: 1, short: 'Baseline',
    title: 'Baseline: 60 FPS, no added lag',
    sub: 'The view follows the reticle exactly. This is what responsive feels like.',
    // lag 0 is explicit: with warp off the W coupling would otherwise leave 150 ms.
    warp: false, hz: 60, lag: 0, ghost: true },
  { ...base, key: 2, short: 'Problem',
    title: 'The problem: 30 FPS + pipeline lag',
    sub: 'Green ring = where the hand is now. The picture is behind it.',
    // lag 150 is explicit: coming from chapter 1 (warp already off) setWarp is
    // not re-run, so the coupling would not restore the lag on its own.
    warp: false, hz: 30, lag: 150, ghost: true },
  { ...base, key: 3, short: 'Fix',
    title: 'The fix: Frame Warp',
    sub: 'The old frame is reprojected to the fresh input. The ring sits on the crosshair.',
    warp: true, hz: 30, ghost: true },
  { ...base, key: 4, short: 'Side by side',
    title: 'Side by side: raw frame vs reprojected',
    sub: 'Left: the frame as rendered. Right: the same frame, shifted to now.',
    view: 'sbs' },
  { ...base, key: 5, short: 'X-ray',
    title: 'How it works: the guard band',
    sub: 'Rendered wider than shown. The crop slides by the rotation since the frame was drawn.',
    view: 'xray', autopilot: XRAY_SWEEP },
  { ...base, key: 6, short: 'Freeze',
    title: "Freeze: no new frames, the view still turns",
    sub: 'Zero new frames from the renderer. Press . to step one.',
    frozen: true, autopilot: FREEZE_SWEEP, ghost: true },
  { ...base, key: 7, short: 'Limits',
    title: 'Guard band limits',
    sub: 'Cyan = pixels from the margin. Red = ran out, clamped.',
    zones: true, guard: 6, autopilot: FLICK_SWEEP },
  { ...base, key: 8, short: 'Object motion',
    title: "What it can't fix: object motion",
    sub: "The target's own motion is baked into old pixels. Press M for motion vectors.",
    hz: 10, mv: false },
  { ...base, key: 9, short: 'Latency',
    title: 'Measured latency',
    sub: 'Orange: measured staleness. Blue: display interval, a proxy floor, not photon-measured.',
    charts: true },
];

/** A frozen chapter freezes this long after the autopilot starts, so the frozen
 *  frame is one rendered along the chapter's own sweep (not the last chapter's aim). */
export const FREEZE_SETTLE_MS = 500;

/**
 * Apply one preset through a system adapter `sys` (real one built in
 * installChapters, fake one in the tests). Order is fixed:
 *   1. cancel the side shows (feel-the-lag, A/B test, slow-mo)
 *   2. reset the stateful views: autopilot stopped, unfrozen, normal, zones off
 *   3. write every preset field; expensive / visible setters (sliders, warp,
 *      chart resize) only when the value differs, so re-applying is quiet
 *   4. start the autopilot, then (deferred) freeze if the chapter freezes.
 *
 * sys: cancelSideShows() → true if the lag slider was clobbered,
 *      getWarp/setWarp, getHz/setHz, getGuard/setGuard, getLag/setLag,
 *      getMV/setMV, setView, setFrozen, setZones, setGhost, setHeatmap,
 *      getCharts/setCharts, autopilot { stop, configure, start },
 *      later(fn, ms) → cancel handle (deferred freeze).
 */
export function applyPreset(sys, p) {
  const lagClobbered = !!sys.cancelSideShows?.();

  sys.autopilot.stop();
  sys.setFrozen(false);
  sys.setView('normal');
  sys.setZones(false);

  if (sys.getHz() !== p.hz) sys.setHz(p.hz);
  if (sys.getGuard() !== p.guard) sys.setGuard(p.guard);
  // setWarp re-derives the injected lag from the warp state (main.js); force it
  // if a cancelled feel-the-lag ramp just rewrote the lag slider.
  if (sys.getWarp() !== p.warp || lagClobbered) sys.setWarp(p.warp);
  if (p.lag !== null && sys.getLag() !== p.lag) sys.setLag(p.lag);
  if (sys.getMV() !== p.mv) sys.setMV(p.mv);

  sys.setHeatmap(p.heatmap);
  if (sys.getCharts() !== p.charts) sys.setCharts(p.charts);
  sys.setGhost(p.ghost);

  sys.setView(p.view);
  sys.setZones(p.zones);

  sys.autopilot.configure({ ...p.autopilot });
  sys.autopilot.start();

  if (p.frozen) return sys.later(() => sys.setFrozen(true), FREEZE_SETTLE_MS);
  return null;
}

/**
 * @param ctx { presenter, views, autopilot, feelTheLag, abtest, heatmap,
 *              onboarding, scoreboard, accuracyChart, setWarp, getWarpEnabled,
 *              getMotionVectorsOn, setMotionVectorsOn, getSlowMo, setSlowMo,
 *              getChartsExpanded, setChartsExpanded }
 */
export function installChapters(ctx) {
  const body = document.body;
  const root = document.documentElement;
  const dock = document.getElementById('chapter-dock');
  const strip = document.getElementById('chapter-strip');
  const capTitle = document.querySelector('#chapter-caption .cc-title');
  const capSub = document.querySelector('#chapter-caption .cc-sub');
  const capBox = document.getElementById('chapter-caption');
  const $ = (id) => document.getElementById(id);

  let current = 0;          // 0 = no chapter playing
  let pendingFreeze = null; // deferred freeze timer

  // --- Slider plumbing (same path as the panel / controls.js) --------------
  const slider = (id) => $(id);
  const readSlider = (id) => parseFloat(slider(id)?.value);
  function driveSlider(id, v) {
    const sl = slider(id);
    if (!sl) return;
    sl.value = String(v);
    sl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const sys = {
    cancelSideShows() {
      const ramp = !!ctx.feelTheLag?.isActive?.();
      ctx.feelTheLag?.stop?.();      // restores its resting lag if it was running
      ctx.abtest?.cancel?.();
      ctx.onboarding?.cancel?.();
      // Shift+M slow-mo: clear the flag and its dataset.prev hack; the Hz field
      // below then sets the source rate explicitly.
      if (ctx.getSlowMo?.()) ctx.setSlowMo(false);
      const hz = slider('sl-hz');
      if (hz) delete hz.dataset.prev;
      return ramp;
    },
    getWarp: () => !!ctx.getWarpEnabled(),
    setWarp: (on) => ctx.setWarp(on, { quiet: true }), // badge updates; no pulse / SFX
    getHz: () => readSlider('sl-hz'),
    setHz: (v) => driveSlider('sl-hz', v),
    getGuard: () => readSlider('sl-guard'),
    setGuard: (v) => driveSlider('sl-guard', v),
    getLag: () => readSlider('sl-lag'),
    setLag: (v) => {
      driveSlider('sl-lag', v);
      const h = $('hud-lag'); if (h) h.textContent = v + ' ms';
    },
    getMV: () => !!ctx.getMotionVectorsOn(),
    setMV: (v) => ctx.setMotionVectorsOn(v),
    setView: (v) => ctx.views.setView(v),
    setFrozen: (v) => ctx.views.setFrozen(v),
    setZones: (v) => ctx.views.setZones(v),
    setGhost: (v) => ctx.presenter.setGhost(v),
    setHeatmap: (v) => ctx.heatmap?.set?.(v),
    getCharts: () => !!ctx.getChartsExpanded(),
    setCharts: (v) => ctx.setChartsExpanded(v),
    autopilot: {
      stop: () => ctx.autopilot.stop(),
      configure: (o) => ctx.autopilot.configure(o),
      start: () => ctx.autopilot.start(),
    },
    later: (fn, ms) => setTimeout(fn, ms),
  };

  // --- "You are here" strip ------------------------------------------------
  if (strip) {
    strip.innerHTML = CHAPTERS.map((c) =>
      `<button class="cs-pill" data-ch="${c.key}" tabindex="-1">` +
      `<b>${c.key}</b>${c.short}</button>`).join('');
    strip.addEventListener('click', (e) => {
      const b = e.target.closest?.('.cs-pill');
      if (!b) return;
      e.stopPropagation();
      go(+b.dataset.ch);
    });
  }

  // Keep --dock-h in sync with the dock's real height so the scoreboard, the
  // zones legend and the x-ray readout can sit just above it at any size.
  function syncDockHeight() {
    const h = body.classList.contains('chapters') && dock ? dock.offsetHeight + 12 : 0;
    root.style.setProperty('--dock-h', h + 'px');
  }
  if (dock && typeof ResizeObserver === 'function') new ResizeObserver(syncDockHeight).observe(dock);
  window.addEventListener('resize', syncDockHeight);

  function render(ch) {
    for (const b of strip?.querySelectorAll('.cs-pill') || []) {
      b.classList.toggle('active', +b.dataset.ch === ch.key);
      b.classList.toggle('done', +b.dataset.ch < ch.key);
    }
    if (capTitle) capTitle.textContent = ch.title;
    if (capSub) capSub.textContent = ch.sub;
    if (capBox) { // re-run the entrance animation
      capBox.classList.remove('enter');
      void capBox.offsetWidth;
      capBox.classList.add('enter');
    }
  }

  // --- Public API ------------------------------------------------------------
  function go(n) {
    const ch = CHAPTERS.find((c) => c.key === n);
    if (!ch) return current;
    if (!ctx.presenter.isOn()) ctx.presenter.set(true);
    clearTimeout(pendingFreeze);
    pendingFreeze = null;
    current = n;
    body.classList.add('chapters');
    pendingFreeze = applyPreset(sys, ch);
    render(ch);
    syncDockHeight();
    console.log(`[FrameWarp] chapter ${n}: ${ch.title}`);
    return current;
  }
  const next = () => go(Math.min(CHAPTERS.length, current + 1));
  const prev = () => go(Math.max(1, current - 1));

  /** Leave chapter mode (UI only; the current state stays as it is). */
  function exit() {
    clearTimeout(pendingFreeze);
    pendingFreeze = null;
    current = 0;
    body.classList.remove('chapters');
    syncDockHeight();
  }

  function resetScores() {
    ctx.scoreboard?.reset?.();
    ctx.accuracyChart?.reset?.();
    ctx.presenter?.caption?.('Scores reset');
    console.log('[FrameWarp] scores reset');
  }

  // Presenter mode off → chapter mode off (the chapter UI only exists there).
  window.addEventListener('framewarp:presenter', (e) => { if (!e.detail?.on) exit(); });

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (ctx.views?.isTypingEvent?.(e)) return;
    const code = e.code || '';
    const digit = /^Digit([0-9])$/.exec(code);
    if (digit) {
      const n = +digit[1];
      if (n === 0) { resetScores(); return; }
      e.preventDefault();
      go(n);                              // turns presenter mode on if needed
      return;
    }
    if (!ctx.presenter.isOn()) return;    // paging keys only while presenting
    if (code === 'PageDown' || code === 'ArrowRight') { e.preventDefault(); next(); }
    else if (code === 'PageUp' || code === 'ArrowLeft') { e.preventDefault(); prev(); }
  });

  return { go, next, prev, exit, current: () => current, resetScores };
}
