/* ---------------------------------------------------------------------------
   autopilot.js — Hands-free camera driver (presenter mode, attract loop)
   ---------------------------------------------------------------------------
   The core effect of Frame Warp is felt in the hand, and a projector audience
   never sees the hand. The autopilot replaces the hand with a repeatable,
   known motion so the ON/OFF contrast is identical across a W toggle, survives
   a lost pointer lock, and doesn't depend on a nervous presenter's wrist.

   It writes straight into the same Input yaw/pitch the live demo reads (exactly
   what a mousemove does), so the UNCHANGED pipeline lags and reprojects it like
   a human's motion. Nothing downstream knows it isn't a person.

   Two modes:
     • 'sine'  — a smooth look sweep around the origin (tunable amplitude and
                 period). This is the attract loop's motion.
     • 'track' — follows the target's angular path along its track, low-passed
                 so the triangle-wave corners are rounded like a human's
                 reversal. Needs ctx.getTrackAim(); falls back to 'sine'.

   The tick is a self-owned requestAnimationFrame loop that only exists while
   running, so the render loop in main.js is not touched and costs nothing when
   the autopilot is off.

   Cancelling: only stop(), toggle(), or REAL mouse motion while the pointer is
   locked (the only time input.js honours mousemove). Hotkeys never cancel it.
--------------------------------------------------------------------------- */

const TWO_PI = Math.PI * 2;

/**
 * @param {object} ctx
 *   input          the shared Input (yaw/pitch are written each tick)
 *   mode           'sine' | 'track'                        (default 'sine')
 *   amplitude      sine: yaw amplitude, radians            (default 0.42)
 *   pitchAmplitude sine: pitch amplitude, radians          (default 0.06)
 *   period         sine: seconds per yaw cycle             (default 3.6)
 *   smoothing      track: low-pass time constant, seconds  (default 0.08)
 *   getTrackAim    track: () => { yaw, pitch } aim at the target right now
 *   cancelOnMouse  stop on real mouse motion while locked  (default true)
 *   onTick(now)    optional hook, called after each write
 *   onStop(reason) optional hook: 'manual' | 'mouse'
 */
export function createAutopilot(ctx) {
  const { input } = ctx;
  const opts = {
    mode: ctx.mode || 'sine',
    amplitude: ctx.amplitude ?? 0.42,
    pitchAmplitude: ctx.pitchAmplitude ?? 0.06,
    period: ctx.period ?? 3.6,
    smoothing: ctx.smoothing ?? 0.08,
  };

  let running = false;
  let raf = 0;
  let startT = 0;
  let lastT = 0;

  function sine(now) {
    const t = (now - startT) / 1000;
    input.yaw = Math.sin(t * (TWO_PI / opts.period)) * opts.amplitude;
    input.pitch = Math.sin(t * (TWO_PI / (opts.period * 1.7))) * opts.pitchAmplitude;
  }

  function track(now) {
    const aim = ctx.getTrackAim();
    const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
    // First-order low-pass toward the target's angular position. Frame-rate
    // independent (exponential), so a 60 Hz projector and a 165 Hz laptop
    // produce the same motion.
    const k = opts.smoothing > 0 ? 1 - Math.exp(-dt / opts.smoothing) : 1;
    input.yaw += (aim.yaw - input.yaw) * k;
    input.pitch += (aim.pitch - input.pitch) * k;
  }

  function tick(now) {
    if (!running) return;
    if (opts.mode === 'track' && typeof ctx.getTrackAim === 'function') track(now);
    else sine(now);
    lastT = now;
    ctx.onTick?.(now);
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (running) return true;
    running = true;
    startT = lastT = performance.now();
    raf = requestAnimationFrame(tick);
    return true;
  }

  function stop(reason = 'manual') {
    if (!running) return false;
    running = false;
    cancelAnimationFrame(raf);
    ctx.onStop?.(reason);
    return false;
  }

  // Real mouse motion takes the camera back — but only while the pointer is
  // locked, i.e. only when input.js would actually apply it. Unlocked cursor
  // wiggles (the presenter reaching for the laptop) never cancel it.
  if (ctx.cancelOnMouse !== false) {
    document.addEventListener('mousemove', (e) => {
      if (running && input.locked && (e.movementX || e.movementY)) stop('mouse');
    });
  }

  return {
    start,
    stop,
    toggle: () => (running ? stop() : start()),
    isRunning: () => running,
    /** Tune live: { mode, amplitude, pitchAmplitude, period, smoothing }. */
    configure(o = {}) { Object.assign(opts, o); return { ...opts }; },
    get options() { return { ...opts }; },
  };
}

/**
 * Aim (yaw, pitch) from the camera position at a target on the track, for
 * 'track' mode. Kept pure so it can be unit-checked. Camera looks down -Z;
 * positive yaw turns toward -X, positive pitch looks up.
 */
export function aimAt(cam, p) {
  const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(dy, Math.hypot(dx, dz)),
  };
}
