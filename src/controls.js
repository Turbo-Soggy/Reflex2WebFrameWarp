/* ---------------------------------------------------------------------------
   controls.js — Keyboard handling + the recording indicator
   ---------------------------------------------------------------------------
   Keys: W = warp · M = motion vectors · Shift+M = slow-mo · L = feel-the-lag
   ramp · D = demo mode · X = mute · I = about/theory · ? = cheat-sheet ·
   R = record · E = export CSV · T = record an input trace (downloads JSON on
   stop — feed it to bench/run.js). The toggled app state is read/written
   through `ctx` accessors so main keeps owning it (and the render loop sees the
   same values); the warp toggle routes through ctx.setWarp (main.js) so every
   side-effect lives in one place.
--------------------------------------------------------------------------- */

import { downloadTrace } from './replay/trace.js';

/**
 * @param {object} ctx
 *   refs:    scoreboard, recorder, traceRecorder, applyWarpLag
 *   get/set: getWarpEnabled/setWarpEnabled, getMotionVectorsOn/setMotionVectorsOn,
 *            getDemoMode/setDemoMode, getSlowMo/setSlowMo
 * @returns {{ updateRecIndicator: () => void }} so the render loop can refresh it
 */
export function installControls(ctx) {
  const recEl = document.getElementById('rec-indicator');

  // About / Theory panel (Phase 6): toggled by the i key, the ⓘ button, or by
  // clicking the dimmed backdrop.
  const toggleAbout = () => document.getElementById('about')?.classList.toggle('show');
  document.getElementById('about-btn')?.addEventListener('click', toggleAbout);
  document.getElementById('about')?.addEventListener('click', (e) => {
    if (e.target.id === 'about') toggleAbout(); // backdrop click closes
  });

  function updateRecIndicator() {
    if (ctx.recorder.recording) {
      recEl.textContent = `● REC  ${ctx.recorder.sampleCount}`;
      recEl.classList.add('active');
    } else {
      recEl.textContent = ctx.recorder.sampleCount
        ? `${ctx.recorder.sampleCount} samples — press E to export`
        : 'press R to record';
      recEl.classList.remove('active');
    }
  }

  window.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
      case 'w':
        // All the warp side-effects (lag, scoreboard, pulse, SFX, event) live in
        // one place — main.js setWarp — so the key just flips the bit.
        ctx.setWarp(!ctx.getWarpEnabled());
        break;
      case 'l':
        ctx.feelTheLag.toggle(); // "Feel the Lag" progressive ramp (Phase 4)
        break;
      case 'x': {
        const muted = ctx.audio?.toggleMute();
        console.log('[FrameWarp] audio', muted ? 'MUTED' : 'UNMUTED');
        break;
      }
      case '?':
      case '/':
        document.getElementById('cheatsheet').classList.toggle('show');
        break;
      case 'i':
        toggleAbout(); // About / Theory panel
        break;
      case 'g':
        ctx.toggleCharts?.(); // expand / restore the chart panel (§4C)
        break;
      case 'h': {
        const on = ctx.heatmap?.toggle(); // aim-vs-display heat map (§3C)
        console.log('[FrameWarp] heat map', on ? 'ON' : 'OFF');
        break;
      }
      case 'b':
        ctx.abtest?.toggle(); // automated A/B test + recorded replay (§3A/§3B/§6C)
        break;
      case 'r':
        console.log('[FrameWarp] recording', ctx.recorder.toggle(performance.now()) ? 'STARTED' : 'STOPPED');
        updateRecIndicator();
        break;
      case 'e':
        ctx.recorder.download();
        break;
      case 't': {
        // Input-trace recording (replay system). Start: begins sampling the
        // pose each tick. Stop: downloads the trace as JSON for bench/run.js.
        const on = ctx.traceRecorder.toggle(performance.now());
        if (!on && ctx.traceRecorder.samples.length) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          downloadTrace(ctx.traceRecorder.toTrace(`session-${stamp}`));
        }
        console.log('[FrameWarp] input trace', on
          ? 'RECORDING (T stops + downloads)'
          : `STOPPED — ${ctx.traceRecorder.samples.length} samples downloaded`);
        break;
      }
      case 'd': {
        const on = !ctx.getDemoMode();
        ctx.setDemoMode(on);
        document.body.classList.toggle('demo-mode', on);
        console.log('[FrameWarp] demo mode', on ? 'ON (scores only)' : 'OFF (tech readouts)');
        break;
      }
      case 'm':
        if (e.shiftKey) {
          // Shift+M: toggle slow-mo by driving the Source-rate slider (keeps the
          // panel, label and LagSim in sync via the normal slider path).
          const sl = document.getElementById('sl-hz');
          const on = !ctx.getSlowMo();
          ctx.setSlowMo(on);
          if (on) { sl.dataset.prev = sl.value; sl.value = '10'; }
          else { sl.value = sl.dataset.prev || '30'; }
          sl.dispatchEvent(new Event('input', { bubbles: true }));
          console.log('[FrameWarp] slow-mo', on ? 'ON (10 FPS)' : 'OFF');
        } else {
          ctx.setMotionVectorsOn(!ctx.getMotionVectorsOn());
          console.log('[FrameWarp] motion vectors', ctx.getMotionVectorsOn() ? 'ON' : 'OFF');
        }
        break;
    }
  });

  updateRecIndicator();
  return { updateRecIndicator };
}
