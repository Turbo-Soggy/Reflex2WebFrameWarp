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
--------------------------------------------------------------------------- */

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

  let raf = 0, active = false, startT = 0, lastFlip = 0;
  let lastActivity = performance.now();

  const shown = (el) => !!el && el.classList.contains('show');
  // Only attract from a clean idle screen — never over the summary card, the
  // cheat-sheet, the about panel, or while the mouse is captured.
  const canStart = () =>
    !active && !isLocked() &&
    overlay && !overlay.classList.contains('hidden') &&
    !shown(summary) && !shown(cheats) && !shown(about);

  function setCaption(on) {
    if (!caption) return;
    caption.className = on ? 'on' : 'off';
    caption.innerHTML = on
      ? 'Frame Warp <b>ON</b><span>the view tracks your motion — sharp and immediate</span>'
      : 'Frame Warp <b>OFF</b><span>the view lags your motion at 30 FPS</span>';
  }

  function tick(now) {
    if (!active) return;
    const t = (now - startT) / 1000;
    // Smooth sweep so panning the camera makes the warp ON/OFF difference visible.
    input.yaw = Math.sin(t * (2 * Math.PI / YAW_PERIOD)) * AMP_YAW;
    input.pitch = Math.sin(t * (2 * Math.PI / (YAW_PERIOD * 1.7))) * AMP_PITCH;

    if (now - lastFlip > PHASE_MS) {
      lastFlip = now;
      setWarp(!getWarpEnabled());
      setCaption(getWarpEnabled()); // reflects the new state
    }
    raf = requestAnimationFrame(tick);
  }

  function start() {
    active = true;
    startT = performance.now();
    lastFlip = startT;                       // hold the first (OFF) phase fully
    if (getWarpEnabled()) setWarp(false);    // open in the "problem" state
    setCaption(false);
    document.body.classList.add('attract');
    raf = requestAnimationFrame(tick);
    console.log('[FrameWarp] attract mode STARTED (idle)');
  }

  function stop() {
    if (!active) return;
    active = false;
    cancelAnimationFrame(raf);
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

  return { start, stop, isActive: () => active };
}
