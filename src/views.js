/* ---------------------------------------------------------------------------
   views.js — The mechanism views (Phase 2): side-by-side, x-ray, freeze, zones
   ---------------------------------------------------------------------------
   One place owns the view state so the keys (controls.js) and, later, the
   presenter's chapter system can drive it idempotently:

     view   'normal' | 'sbs' | 'xray'   (S and V; mutually exclusive)
     frozen boolean                     (Space; '.' steps one source frame)
     zones  boolean                     (Z; guard-band zone tint in the shader)

   Freeze and the zone tint compose with any view. Every non-normal view, and
   freeze, lock shooting (locksShooting()): a shot there would be scored against
   a picture that is not the normal single-view demo.

   composite() is the display-rate draw the render loop calls instead of a bare
   quad.render():
     • normal — exactly the old single fullscreen draw.
     • sbs    — two draws of the SAME texture in one frame, letterboxed so each
                half keeps the full aspect and FOV: left = delta 0, MV off (the
                raw frame); right = the live delta (only when W is on). One full
                clear first, then the scissored per-half draws.
     • xray   — the whole wide-FOV texture through a guard-0 quad (delta 0) and
                the xray.js overlay driven by the shader's own du/dv/guard.
--------------------------------------------------------------------------- */

import { installXray } from './xray.js';

const VIEWS = ['normal', 'sbs', 'xray'];

/**
 * @param deps { lag, quad, xrayQuad }
 *   lag       LagSim (freeze sets lag.paused; step calls lag.stepOnce())
 *   quad      the normal QuadRenderer (guard = current guard band)
 *   xrayQuad  a second QuadRenderer left at guard 0 (draws the whole texture)
 */
export function installViews({ lag, quad, xrayQuad }) {
  let view = 'normal';
  let frozen = false;
  let zones = false;

  const body = document.body;
  const xray = installXray();
  const sbsNote = document.getElementById('sbs-warp-note');
  let lastSbsWarp = null;

  function setView(name) {
    if (!VIEWS.includes(name)) {
      console.warn('[FrameWarp] unknown view', name);
      return view;
    }
    if (name === view) return view; // idempotent
    view = name;
    body.classList.toggle('sbs', view === 'sbs');
    body.classList.toggle('xray', view === 'xray');
    xray.show(view === 'xray');
    lastSbsWarp = null; // refresh the sbs warp note on entry
    console.log('[FrameWarp] view', view.toUpperCase());
    return view;
  }

  /** S / V: toggle a view on, or back to normal if it is already showing. */
  function toggleView(name) {
    return setView(view === name ? 'normal' : name);
  }

  function setFrozen(on) {
    on = !!on;
    if (on === frozen) return frozen;
    frozen = on;
    lag.paused = on;
    body.classList.toggle('frozen', on);
    console.log('[FrameWarp] source', on ? 'FROZEN (warp keeps running; . steps one frame)' : 'RESUMED');
    return frozen;
  }

  /** '.': one new source frame. Not frozen yet → freeze first (no step). */
  function stepOnce() {
    if (!frozen) { setFrozen(true); return; }
    lag.stepOnce();
    console.log('[FrameWarp] step: one source frame');
  }

  function setZones(on) {
    on = !!on;
    if (on === zones) return zones;
    zones = on;
    quad.setShowZones(on);
    xrayQuad.setShowZones(on);
    body.classList.toggle('zones', on);
    console.log('[FrameWarp] guard-band zones', on ? 'ON' : 'OFF');
    return zones;
  }

  // Keys must not fire while the user types into a field (or drags a slider).
  const isTypingEvent = (e) => {
    const t = e.target;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                   t.tagName === 'SELECT' || t.isContentEditable);
  };

  const getViewState = () => ({ view, frozen, zones });
  const isFrozen = () => frozen;
  const locksShooting = () => frozen || view !== 'normal';

  /**
   * Display-rate composite. Called once per rAF tick by main.js.
   * @param f { renderer, texture, du, dv, dYaw, dPitch, warpEnabled, mv, W, H,
   *            guard, frameAgeMs, now }
   *   du/dv are the live (warp-on) shift; mv the live motion-vector inputs.
   */
  function composite(f) {
    const { renderer, texture, W, H, mv } = f;
    const live = f.warpEnabled ? [f.du, f.dv] : [0, 0];

    if (view === 'sbs') {
      // One full clear, then two scissored draws (autoClear then only clears
      // inside each half's scissor rect, so the halves never wipe each other).
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
      renderer.clear();
      // Letterbox: each half is W/2 × H/2 — the full-screen aspect — centred
      // vertically, so FOV and aspect match the normal view exactly.
      const hw = Math.floor(W / 2), hh = Math.floor(H / 2), y = Math.floor(H / 4);
      const rawMv = { texture: mv.texture, dtSeconds: 0, enabled: false };
      quad.render(renderer, texture, [0, 0], W, H, rawMv, { x: 0, y, w: hw, h: hh });
      quad.render(renderer, texture, live, W, H, mv, { x: W - hw, y, w: hw, h: hh });
      if (sbsNote && lastSbsWarp !== f.warpEnabled) {
        lastSbsWarp = f.warpEnabled;
        sbsNote.textContent = f.warpEnabled
          ? 'warp ON'
          : 'warp OFF: identical to the left · press W';
        sbsNote.classList.toggle('off', !f.warpEnabled);
      }
      return;
    }

    if (view === 'xray') {
      const rawMv = { texture: mv.texture, dtSeconds: 0, enabled: false };
      xrayQuad.render(renderer, texture, [0, 0], W, H, rawMv);
      xray.update({
        du: f.du, dv: f.dv, guard: f.guard, W, H,
        dYaw: f.dYaw, dPitch: f.dPitch, frameAgeMs: f.frameAgeMs,
        warpEnabled: f.warpEnabled, now: f.now,
      });
      return;
    }

    quad.render(renderer, texture, live, W, H, mv);
  }

  return {
    getViewState, setView, toggleView, setFrozen, stepOnce, setZones,
    isFrozen, locksShooting, composite, isTypingEvent,
  };
}
