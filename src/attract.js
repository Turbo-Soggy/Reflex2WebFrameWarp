/* ---------------------------------------------------------------------------
   attract.js — Idle "attract" / auto-demo loop (the brief's §1B)
   ---------------------------------------------------------------------------
   What catches someone walking past a poster booth. After the demo sits idle
   for a while (no input, mouse not captured), it runs itself: a gentle
   tracking-like sweep pans the view while Frame Warp flips ON/OFF every few
   seconds, with a caption naming what's on screen. The latency chart and HUD
   keep animating underneath, so the whole story plays without anyone touching
   anything. The first real interaction (move, click, key, or capturing the
   mouse) stops it instantly and hands control back.

   How it pans without a real mouse: it writes straight into the same Input
   yaw/pitch the live demo reads, so the unchanged pipeline lags + reprojects it
   exactly as it would a human's motion — the warp ON/OFF contrast is the real
   thing, not a canned animation. On stop it recentres the view and drops warp
   back OFF so whoever steps up starts in the honest "problem" state.

   The sweep itself lives in autopilot.js (one implementation, shared with the
   presenter's hands-free 'A' driver); this module only owns the idle timer,
   the warp flips and the caption. disable()/enable() let presenter mode (and
   the chapter system) switch the idle loop off entirely.
--------------------------------------------------------------------------- */

import { createAutopilot } from './autopilot.js';

export function installAttract(ctx) {
  const { input, setWarp, getWarpEnabled, isLocked } = ctx;
  const caption = document.getElementById('attract-caption');
  const overlay = document.getElementById('overlay');
  const summary = document.getElementById('summary');
  const cheats = document.getElementById('cheatsheet');
  const about = document.getElementById('about');

  const IDLE_MS = 30000;       // sit idle this long → start attracting
  const AMP_YAW = 0.42;        // sweep amplitude (radians) — tracking-like
  const AMP_PITCH = 0.06;
  const YAW_PERIOD = 3.6;      // seconds per look cycle
  const PHASE_MS = 5000;       // flip warp every 5 s

  let active = false, disabled = false, lastFlip = 0;
  let lastActivity = performance.now();

  // The shared sweep driver. Attract cancels on ANY interaction via bump()
  // below, so the autopilot's own mouse-cancel is redundant here.
  const pilot = createAutopilot({
    input, mode: 'sine', cancelOnMouse: false,
    amplitude: AMP_YAW, pitchAmplitude: AMP_PITCH, period: YAW_PERIOD,
    onTick: flipTick,
  });

  const shown = (el) => !!el && el.classList.contains('show');
  // Only attract from a clean idle screen — never over the summary card, the
  // cheat-sheet, the about panel, or while the mouse is captured.
  const canStart = () =>
    !active && !disabled && !isLocked() &&
    !ctx.isBusy?.() &&                       // e.g. the presenter's autopilot
    overlay && !overlay.classList.contains('hidden') &&
    !shown(summary) && !shown(cheats) && !shown(about);

  function setCaption(on) {
    if (!caption) return;
    caption.className = on ? 'on' : 'off';
    caption.innerHTML = on
      ? 'Frame Warp <b>ON</b><span>the view tracks your motion — sharp and immediate</span>'
      : 'Frame Warp <b>OFF</b><span>the view lags your motion at 30 FPS</span>';
  }

  // Per-tick hook from the autopilot: flip warp every PHASE_MS.
  function flipTick(now) {
    if (!active) return;
    if (now - lastFlip > PHASE_MS) {
      lastFlip = now;
      setWarp(!getWarpEnabled());
      setCaption(getWarpEnabled()); // reflects the new state
    }
  }

  function start() {
    active = true;
    lastFlip = performance.now();            // hold the first (OFF) phase fully
    if (getWarpEnabled()) setWarp(false);    // open in the "problem" state
    setCaption(false);
    document.body.classList.add('attract');
    pilot.start();
    console.log('[FrameWarp] attract mode STARTED (idle)');
  }

  function stop() {
    if (!active) return;
    active = false;
    pilot.stop();
    document.body.classList.remove('attract');
    input.yaw = 0; input.pitch = 0;          // recentre for whoever steps up
    if (getWarpEnabled()) setWarp(false);    // hand over in the honest OFF state
    console.log('[FrameWarp] attract mode STOPPED');
  }

  // Any real interaction resets the idle clock and ends an attract session.
  function bump() {
    lastActivity = performance.now();
    if (active) stop();
  }
  for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(ev, bump, { passive: true });
  }
  document.addEventListener('pointerlockchange', bump);

  // Cheap 1 Hz idle check (no per-frame cost when not attracting).
  setInterval(() => {
    if (canStart() && performance.now() - lastActivity > IDLE_MS) start();
  }, 1000);

  /** Switch the idle loop off (stops a running session). Presenter mode. */
  function disable() {
    disabled = true;
    stop();
  }
  /** Re-arm the idle loop; the idle clock restarts from now. */
  function enable() {
    disabled = false;
    lastActivity = performance.now();
  }

  return { start, stop, disable, enable, isActive: () => active, isEnabled: () => !disabled };
}
