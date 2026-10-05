/* ---------------------------------------------------------------------------
   heatmap.js — Live "where you're aiming vs. what the screen shows" overlay
   ---------------------------------------------------------------------------
   A real-time picture of the thesis statement (the brief's §3C). Two dots:

     • GREEN — your true aim. It sits at the centre because it's the reference:
       where you are looking RIGHT NOW (the freshest input).
     • RED   — what the screen is actually showing. With warp OFF this lags
       behind your motion, so it drifts away from centre while you track; the
       gap between the dots IS the view-direction latency. With warp ON the
       compositor shifts the image by the fresh-minus-rendered delta, so the
       red dot lands on the green one and the gap collapses.

   The caller passes the pose the compositor ACTUALLY displayed: the rendered
   pose plus the delta that was really applied to the quad (converted back from
   UV to angles). The collapse under warp ON is therefore measured from the
   applied delta, not assumed from the warp flag: if the warp were ever clamped,
   rate-limited or applied late, the residual would show up here. The gap is
   expressed as a fraction of the display FOV (at the live aspect ratio) and
   magnified (GAIN) so a few degrees reads as a clear, visible divergence.
   Pure Canvas 2D; toggled with H; hidden by default.
--------------------------------------------------------------------------- */

import { DISPLAY_FOV_Y, fovXRad } from './config.js';

const GAIN = 9;        // magnify the small angular gap so the divergence reads
const TRAIL = 22;      // length of the red-dot (display) trail
const C_AIM = '#7cffb2';
const C_DISP = '#ff5c6c';

const clamp1 = (v) => Math.max(-1, Math.min(1, v));

export function installHeatmap() {
  const wrap = document.getElementById('heatmap');
  const canvas = document.getElementById('heatmap-canvas');
  if (!wrap || !canvas) return { update() {}, toggle() {}, set() {}, visible: () => false };

  const ctx = canvas.getContext('2d');
  const fovY = (DISPLAY_FOV_Y * Math.PI) / 180; // display vertical FOV (rad)

  // Live aspect of the fullscreen view (the quad fills the window), so the
  // horizontal FOV is not a hard-coded 16:9.
  const liveAspect = () => {
    const w = globalThis.innerWidth, h = globalThis.innerHeight;
    return w > 0 && h > 0 ? w / h : undefined; // undefined -> config default
  };

  let visible = false;
  const trail = []; // recent {x, y} display offsets, in screen-fraction units

  /**
   * Preferred form:  update(fresh, displayed[, aspect])
   *   fresh     { yaw, pitch } the freshest input (your true aim)
   *   displayed { yaw, pitch } the pose the compositor actually showed:
   *             rendered pose + the delta applied to the quad, in angles
   *   aspect    optional view aspect (defaults to window.innerWidth/innerHeight)
   *
   * Legacy form (kept for callers not yet migrated):
   *   update(fresh, rendered, warpOn: boolean)
   *   The applied delta is reconstructed the way main.js applies it (the full
   *   fresh - rendered difference when warp is on, zero when off).
   */
  function update(fresh, second, third) {
    if (!visible) return;
    let disp, aspect;
    if (typeof third === 'boolean') {
      const r = second;
      const dYaw = third ? fresh.yaw - r.yaw : 0;
      const dPitch = third ? fresh.pitch - r.pitch : 0;
      disp = { yaw: r.yaw + dYaw, pitch: r.pitch + dPitch };
    } else {
      disp = second;
      if (typeof third === 'number' && third > 0) aspect = third;
    }
    const fovX = fovXRad(DISPLAY_FOV_Y, aspect ?? liveAspect());
    const dx = (fresh.yaw - disp.yaw) / fovX;     // gap as a fraction of the FOV
    const dy = (fresh.pitch - disp.pitch) / fovY;
    trail.push({ x: dx, y: dy });
    if (trail.length > TRAIL) trail.shift();
    draw(dx, dy);
  }

  function draw(dx, dy) {
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) / 2 - 8;
    const toPx = (f) => clamp1(f * GAIN) * R;

    ctx.clearRect(0, 0, W, H);

    // Reticle: crosshair + bounding ring, so the centre reads as "your aim".
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

    // Red trail: fading history of where the screen has been lagging.
    for (let i = 0; i < trail.length; i++) {
      const a = (i + 1) / trail.length;
      const px = cx + toPx(trail[i].x);
      const py = cy + toPx(trail[i].y);
      ctx.fillStyle = `rgba(255,92,108,${0.08 + a * 0.45})`;
      ctx.beginPath();
      ctx.arc(px, py, 1.5 + a * 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // The gap line + the two dots.
    const rx = cx + toPx(dx), ry = cy + toPx(dy);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(rx, ry); ctx.stroke();
    ctx.fillStyle = C_DISP;
    ctx.beginPath(); ctx.arc(rx, ry, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C_AIM;
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
  }

  function toggle() {
    visible = !visible;
    wrap.classList.toggle('show', visible);
    if (!visible) trail.length = 0;
    return visible;
  }

  /** Idempotent setter for the chapter system: set(true/false). */
  function set(on) {
    if (!!on !== visible) toggle();
    return visible;
  }

  return { update, toggle, set, visible: () => visible };
}
