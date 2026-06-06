/* ---------------------------------------------------------------------------
   controls.js — Keyboard handling + the recording indicator
   ---------------------------------------------------------------------------
   Keys: W = warp · M = motion vectors · Shift+M = slow-mo · D = demo mode ·
   R = record · E = export CSV. Logic is unchanged from when it lived in main.js;
   the toggled app state is read/written through `ctx` accessors so main keeps
   owning it (and the render loop sees the same values).
--------------------------------------------------------------------------- */

/**
 * @param {object} ctx
 *   refs:    scoreboard, recorder, applyWarpLag
 *   get/set: getWarpEnabled/setWarpEnabled, getMotionVectorsOn/setMotionVectorsOn,
 *            getDemoMode/setDemoMode, getSlowMo/setSlowMo
 * @returns {{ updateRecIndicator: () => void }} so the render loop can refresh it
 */
export function installControls(ctx) {
  const recEl = document.getElementById('rec-indicator');

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
      case 'w': {
        const on = !ctx.getWarpEnabled();
        ctx.setWarpEnabled(on);
        ctx.scoreboard.setActiveMode(on);
        ctx.applyWarpLag(); // OFF → 150 ms, ON → 50 ms (immediate)
        console.log('[FrameWarp] warp', on ? 'ENABLED' : 'DISABLED');
        break;
      }
      case 'r':
        console.log('[FrameWarp] recording', ctx.recorder.toggle(performance.now()) ? 'STARTED' : 'STOPPED');
        updateRecIndicator();
        break;
      case 'e':
        ctx.recorder.download();
        break;
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
