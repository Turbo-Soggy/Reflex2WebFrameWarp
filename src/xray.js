/* ---------------------------------------------------------------------------
   xray.js — X-ray view: show the whole rendered texture and the crop the warp
             shader is sampling from it (Phase 2, key V)
   ---------------------------------------------------------------------------
   The normal view shows only the central crop of a WIDER render (the guard
   band). In x-ray the whole texture is drawn fullscreen (a guard-0 quad, zero
   delta), and a DOM/SVG overlay draws, on top of it:

     • a dashed rectangle fixed at the centre  → the crop warp-OFF shows; it
       never moves, whatever the mouse does;
     • a solid rectangle that slides            → the crop warp-ON samples,
       from the SAME du, dv, guard, uvScale the shader gets this frame;
     • a marker at the texture centre           → where the frame was rendered
       aiming; one at the solid crop's centre   → where you are aiming now;
     • a readout: Δyaw, Δpitch, frame age and guard used %.

   CROP-RECT DERIVATION (from warp-shader.js, the camSample line):

       camSample = uGuard + (vUv + uDelta) * uScale        (G = uGuard, S = uScale)

   vUv spans [0,1]² over the displayed viewport, so the display samples the
   texture-UV box
       u ∈ [G + du·S,  G + du·S + S]
       v ∈ [G + dv·S,  G + dv·S + S].
   The x-ray quad has G = 0, S = 1, delta 0, so texture UV (u, v) lands on the
   screen at x = u·W and — because the quad's UV origin (vUv = 0,0) is the
   BOTTOM-left of the viewport (PlaneGeometry uv, clip-space −1,−1) while CSS
   `top` counts from the top — y_top = (1 − v)·H. The crop's top edge is its
   HIGHEST v, i.e. v = G + dv·S + S, hence

       left = (G + du·S)·W,   top = (1 − (G + dv·S) − S)·H,   size = S·W × S·H.

   Sign check: looking up raises pitch → dv = +Δpitch/fov_y > 0 → top shrinks →
   the crop moves UP the texture, toward what is above. Turning left raises yaw
   (input.js: yaw −= movementX) → du = −Δyaw/fov_x < 0 → the crop moves LEFT.
   In the normal view the same turn makes the image content slide right (the
   crop window moves left over the scene), which is the pan you feel.

   APPROXIMATION NOTE: Δu = −Δyaw/fov_x (and Δv = Δpitch/fov_y) is a small-angle
   LINEAR approximation — true perspective is linear in tan(angle), not angle.
   This overlay is faithful to the SHADER (it draws exactly what the shader
   samples), not to an exact reprojection.

   The pure maths is exported (cropRectCss, guardUsedPct) and unit-tested in
   test/test.js; all DOM access is inside installXray().
--------------------------------------------------------------------------- */

/**
 * The texture-space box the warp shader samples, in CSS px of a fullscreen
 * (guard-0) draw of the whole texture. Top-left origin, like CSS.
 */
export function cropRectCss(du, dv, guard, W, H) {
  const S = 1 - 2 * guard;
  const u0 = guard + du * S;           // left edge, texture U
  const v0 = guard + dv * S;           // bottom edge, texture V (V up)
  return { left: u0 * W, top: (1 - v0 - S) * H, width: S * W, height: S * H };
}

/**
 * How much of the guard band the current shift uses, in % (100 = the crop edge
 * has reached the texture edge; beyond that the shader clamps). The shift in
 * texture units is du·S (and dv·S); the margin per side is G.
 */
export function guardUsedPct(du, dv, guard) {
  const S = 1 - 2 * guard;
  const shift = Math.max(Math.abs(du * S), Math.abs(dv * S));
  if (guard <= 0) return shift > 0 ? Infinity : 0;
  return (shift / guard) * 100;
}

const RAD2DEG = 180 / Math.PI;
const fmtSigned = (v, d = 2) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);

export function installXray() {
  const root = document.getElementById('xray-overlay');
  if (!root) return { show() {}, update() {} };
  const $ = (id) => document.getElementById(id);
  const shade = $('xray-shade');
  const rectOff = $('xray-rect-off');
  const rectOn = $('xray-rect-on');
  const arrow = $('xray-arrow');
  const dotThen = $('xray-dot-then');
  const dotNow = $('xray-dot-now');
  const lblOff = $('xray-label-off');
  const lblOn = $('xray-label-on');
  const lblThen = $('xray-label-then');
  const lblNow = $('xray-label-now');
  const rYaw = $('xray-r-yaw');
  const rPitch = $('xray-r-pitch');
  const rAge = $('xray-r-age');
  const rGuard = $('xray-r-guard');
  const rMode = $('xray-r-mode');
  const readout = $('xray-readout');

  let visible = false;
  let lastText = 0; // throttle readout text to ~15 Hz so it is legible
  let readoutTop = Infinity; // CSS px; the rect labels are kept above the readout

  const setRect = (el, r) => {
    el.setAttribute('x', r.left.toFixed(1));
    el.setAttribute('y', r.top.toFixed(1));
    el.setAttribute('width', Math.max(0, r.width).toFixed(1));
    el.setAttribute('height', Math.max(0, r.height).toFixed(1));
  };
  const place = (el, x, y) => { el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; };

  function show(on) {
    visible = on;
    root.classList.toggle('show', on);
  }

  /**
   * @param p { du, dv, guard, W, H, dYaw, dPitch, frameAgeMs, warpEnabled, now }
   *   du/dv/guard are the very values handed to the warp shader this frame.
   */
  function update(p) {
    if (!visible) return;
    const { du, dv, guard, W, H } = p;
    const off = cropRectCss(0, 0, guard, W, H); // warp off: fixed central crop
    const on = cropRectCss(du, dv, guard, W, H); // warp on: follows fresh input

    // Shade the margin (everything outside the central crop) ~30 % dark.
    shade.setAttribute('d',
      `M0 0H${W}V${H}H0Z M${off.left} ${off.top}v${off.height}h${off.width}v${-off.height}Z`);
    setRect(rectOff, off);
    setRect(rectOn, on);

    const cx0 = W / 2, cy0 = H / 2;                       // texture centre
    const cx1 = on.left + on.width / 2, cy1 = on.top + on.height / 2; // crop centre
    dotThen.setAttribute('cx', cx0); dotThen.setAttribute('cy', cy0);
    dotNow.setAttribute('cx', cx1); dotNow.setAttribute('cy', cy1);
    // Arrow: stop short of the "now" dot so the head stays visible; hide when tiny.
    const len = Math.hypot(cx1 - cx0, cy1 - cy0);
    if (len > 14) {
      const k = (len - 9) / len;
      arrow.setAttribute('x1', cx0); arrow.setAttribute('y1', cy0);
      arrow.setAttribute('x2', cx0 + (cx1 - cx0) * k); arrow.setAttribute('y2', cy0 + (cy1 - cy0) * k);
      arrow.style.display = '';
    } else {
      arrow.style.display = 'none';
    }

    // Both rect labels sit at their rect's bottom-left, inside (the top corners
    // are under the HUD / parameter panel); the solid one a line higher so the
    // two never collide when the rects coincide (warp idle, Δ = 0).
    // Never under the bottom readout (it moves up above the presenter's chapter
    // dock), whose top is re-read at the ~15 Hz text refresh below.
    const floor = Math.min(H, readoutTop) - 8;
    place(lblOff, off.left + 8, Math.min(off.top + off.height - 32, floor - 30));
    place(lblOn, Math.max(8, on.left + 8), Math.min(H - 60, on.top + on.height - 64, floor - 62)); // stay on screen past 100 %
    place(lblThen, cx0 + 12, cy0 + 10);
    place(lblNow, cx1 + 12, cy1 - 30);

    root.classList.toggle('warp-on', !!p.warpEnabled);

    if (p.now - lastText < 66) return;
    lastText = p.now;
    if (readout) readoutTop = readout.offsetTop || Infinity;
    const used = guardUsedPct(du, dv, guard);
    rYaw.textContent = fmtSigned(p.dYaw * RAD2DEG) + '°';
    rPitch.textContent = fmtSigned(p.dPitch * RAD2DEG) + '°';
    rAge.textContent = Math.max(0, p.frameAgeMs).toFixed(0) + ' ms';
    rGuard.textContent = Number.isFinite(used) ? used.toFixed(0) + ' %' : '∞ (no guard band)';
    rGuard.classList.toggle('over', used > 100);
    rMode.textContent = p.warpEnabled
      ? 'warp ON: the screen shows the solid crop'
      : 'warp OFF: the screen shows the dashed crop';
  }

  return { show, update };
}
