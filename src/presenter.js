/* ---------------------------------------------------------------------------
   presenter.js — Presenter mode + the true-aim ghost reticle (Phase 1)
   ---------------------------------------------------------------------------
   Presenter mode turns the demo into something a speaker can drive in front of
   a projector. Enabled by ?present in the URL or the P key. While on:

     • the idle attract loop and the onboarding walkthrough are switched off
       (they would fight the talk for the screen and the captions);
     • releasing the mouse (Esc) does NOT pop the summary card;
     • R / E / T are ignored (no file downloads mid-talk);
     • the unlocked #overlay is transparent with no card, so the scene stays on
       screen while the presenter talks with the mouse free;
     • F toggles fullscreen;
     • a large permanent WARP ON / WARP OFF badge (top-centre) and a "last key"
       caption that other modules can drive through presenter.caption(text);
     • body.present bumps the HUD / scoreboard / chart / panel text for the room.

   The TRUE-AIM GHOST RETICLE (key J; on by default in presenter mode) is the
   picture of the thesis. The centre crosshair is fixed to the screen, so it
   marks the direction the screen is currently SHOWING. The ghost is drawn
   where the CURRENT input orientation lands in that displayed image:

       offset = ((fresh.yaw − displayed.yaw) / fovX,
                 (fresh.pitch − displayed.pitch) / fovY) × viewport size

   where displayed = rendered pose + the delta the compositor actually applied
   (read back from the quad's uDelta uniform; zero with warp off). With warp off
   the ghost runs ahead of the crosshair while you track; with warp on it sits
   on the crosshair. It runs in its own requestAnimationFrame tick and only
   READS pipeline state, so the render loop in main.js is untouched.
--------------------------------------------------------------------------- */

import { DISPLAY_FOV_Y, fovXRad } from './config.js';

const CAPTION_MS = 1500;
// Projector brightness: the scene reads very dark on a projector, so presenter
// mode raises the display exposure (main.js setExposure) and restores it on exit.
const PRESENT_EXPOSURE = 1.4;
const FOV_Y = (DISPLAY_FOV_Y * Math.PI) / 180;

/**
 * @param {object} ctx
 *   input, warpTarget, camera, quad, lag  pipeline state (read-only here)
 *   getWarpEnabled()                      warp flag (fallback if no uDelta)
 *   attract, onboarding, summary          handles to switch off while presenting
 *   setExposure(v)                        optional; projector brightness hook
 *   views                                 optional; views.getViewState() → hide
 *                                         the ghost outside the normal view
 */
export function installPresenter(ctx) {
  const body = document.body;
  const badge = document.getElementById('present-badge');
  const cap = document.getElementById('present-caption');
  const ghost = document.getElementById('true-aim');

  let on = false;
  let ghostOn = false;
  let capTimer = 0;
  let raf = 0;          // ghost-reticle tick (only scheduled while it is shown)
  let views = ctx.views || null;

  // --- Warp badge --------------------------------------------------------
  function setBadge(warpOn) {
    if (!badge) return;
    badge.textContent = warpOn ? 'WARP ON' : 'WARP OFF';
    badge.classList.toggle('on', warpOn);
    badge.classList.toggle('off', !warpOn);
  }
  window.addEventListener('framewarp:warp', (e) => setBadge(!!e.detail?.on));
  setBadge(!!ctx.getWarpEnabled?.());

  // --- "Last key" caption --------------------------------------------------
  /** Flash a short line under the badge for ~1.5 s. No-op outside presenter mode. */
  function caption(text) {
    if (!on || !cap || !text) return;
    cap.textContent = text;
    cap.classList.add('show');
    clearTimeout(capTimer);
    capTimer = setTimeout(() => cap.classList.remove('show'), CAPTION_MS);
  }

  // --- Mode switch ---------------------------------------------------------
  function set(v) {
    v = !!v;
    if (v === on) return on;
    on = v;
    body.classList.toggle('present', on);
    if (on) {
      ctx.attract?.disable?.();
      ctx.onboarding?.cancel?.();
      ctx.summary?.hide?.();
      setGhost(true);
      setBadge(!!ctx.getWarpEnabled?.());
      ctx.setExposure?.(PRESENT_EXPOSURE);
    } else {
      ctx.attract?.enable?.();
      setGhost(false);
      cap?.classList.remove('show');
      ctx.setExposure?.(1.0);
    }
    // Loose event so the chapter system can leave chapter mode with us.
    window.dispatchEvent(new CustomEvent('framewarp:presenter', { detail: { on } }));
    console.log('[FrameWarp] presenter mode', on ? 'ON' : 'OFF');
    // Shown after the switch so the ON caption actually appears.
    caption('Presenter mode ON');
    return on;
  }

  function toggleFullscreen() {
    if (!on) return false;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
      caption('Fullscreen OFF');
    } else {
      document.documentElement.requestFullscreen?.().catch((err) =>
        console.warn('[FrameWarp] fullscreen refused:', err?.message || err));
      caption('Fullscreen ON');
    }
    return true;
  }

  // --- True-aim ghost reticle ---------------------------------------------
  function setGhost(v) {
    ghostOn = !!v;
    ghost?.classList.toggle('show', ghostOn);
    if (ghostOn) startGhostLoop();
    return ghostOn;
  }

  // Ordering matters: the ghost must be computed AFTER main.js's frame() in the
  // same animation frame, so it compares against the exact input the canvas was
  // just composited with. rAF callbacks run in registration order, and frame()
  // re-registers itself at its start — so we register from a macrotask (after
  // the current frame's callbacks) and from then on sit behind frame().
  let pending = 0;
  function startGhostLoop() {
    if (raf || pending) return;
    pending = setTimeout(() => { pending = 0; raf = requestAnimationFrame(ghostTick); }, 0);
  }
  function toggleGhost() {
    setGhost(!ghostOn);
    caption(ghostOn ? 'True-aim reticle ON' : 'True-aim reticle OFF');
    console.log('[FrameWarp] true-aim reticle', ghostOn ? 'ON' : 'OFF');
    return ghostOn;
  }

  // Normal (single, fullscreen) view only: in side-by-side / x-ray the screen
  // is not one camera, so "where the hand points on it" has no single answer.
  function normalView() {
    const vs = views?.getViewState?.();
    if (!vs) return true;
    const name = typeof vs === 'string' ? vs : (vs.view ?? vs.mode);
    return !name || name === 'normal';
  }

  function ghostTick(ts) {
    raf = 0;
    if (!ghostOn || !ghost) return;
    // Self-heal the ordering: frame() stamps lag.history each tick; if its
    // newest sample predates this animation frame, we ran ahead of it.
    const h = ctx.lag?.history;
    const last = h && h.length ? h[h.length - 1] : null;
    if (last && typeof ts === 'number' && last.t < ts - 0.5) startGhostLoop();
    else raf = requestAnimationFrame(ghostTick);

    if (!normalView()) { ghost.classList.add('suppressed'); return; }
    ghost.classList.remove('suppressed');

    const { input, warpTarget, camera } = ctx;
    const aspect = camera?.aspect || (innerWidth / innerHeight);
    const fovX = fovXRad(DISPLAY_FOV_Y, aspect);

    // Displayed pose = rendered pose + the delta the compositor really applied.
    // uDelta is in display-FOV units: du = −ΔYaw/fovX, dv = ΔPitch/fovY.
    const d = ctx.quad?.material?.uniforms?.uDelta?.value;
    const ry = warpTarget.renderedYaw, rp = warpTarget.renderedPitch;
    let dispYaw, dispPitch;
    if (d) {
      dispYaw = ry - d.x * fovX;
      dispPitch = rp + d.y * FOV_Y;
    } else {
      const w = !!ctx.getWarpEnabled?.();
      dispYaw = w ? input.yaw : ry;
      dispPitch = w ? input.pitch : rp;
    }

    // Positive yaw turns LEFT and positive pitch looks UP, so aiming further
    // than the display shows puts the ghost left / up of the centre.
    const W = innerWidth, H = innerHeight;
    let x = -((input.yaw - dispYaw) / fovX) * W;
    let y = -((input.pitch - dispPitch) / FOV_Y) * H;
    // Keep it on screen (a pinned-to-edge ghost still says "way off").
    const mx = W / 2 - 30, my = H / 2 - 30;
    x = Math.max(-mx, Math.min(mx, x));
    y = Math.max(-my, Math.min(my, y));
    ghost.style.transform = `translate(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px))`;
  }

  // --- Captions for the existing hotkeys -----------------------------------
  // controls.js owns the keys; this listener only NARRATES them for the room.
  // It is registered before controls.js's, so it reads the new state on the
  // next task (setTimeout 0), after controls has applied the key.
  const $ = (id) => document.getElementById(id);
  window.addEventListener('keydown', (e) => {
    if (!on || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    const shift = e.shiftKey;
    setTimeout(() => {
      switch (k) {
        case 'm':
          if (shift) caption(`Source ${$('sl-hz')?.value ?? '?'} FPS`);
          else caption(`Motion vectors ${ctx.getMotionVectorsOn?.() ? 'ON' : 'OFF'}`);
          break;
        case 'l': caption(ctx.feelTheLag?.isActive?.() ? 'Feel the lag: ramp started' : 'Feel the lag: stopped'); break;
        case 'h': caption(`Heat map ${ctx.heatmap?.visible?.() ? 'ON' : 'OFF'}`); break;
        case 'g': caption($('chart-panel')?.classList.contains('expanded') ? 'Charts expanded' : 'Charts restored'); break;
        case 'b': caption(ctx.abtest?.isActive?.() ? 'A/B test started' : 'A/B test closed'); break;
        case 'd': caption(body.classList.contains('demo-mode') ? 'Demo mode ON' : 'Demo mode OFF'); break;
        case 'x': caption(ctx.audio?.muted ? 'Sound muted' : 'Sound on'); break;
      }
    }, 0);
  });

  if (new URLSearchParams(location.search).has('present')) set(true);

  return {
    isOn: () => on,
    set,
    toggle: () => set(!on),
    caption,
    toggleFullscreen,
    setGhost,
    toggleGhost,
    isGhostOn: () => ghostOn,
    /** Late wiring for the views module (Phase 2) if it is created after us. */
    setViews(v) { views = v; },
  };
}
