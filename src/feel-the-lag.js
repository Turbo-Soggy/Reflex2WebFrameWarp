/* ---------------------------------------------------------------------------
   feel-the-lag.js — The "Feel the Lag" progressive demo (Phase 4)
   ---------------------------------------------------------------------------
   A signature moment for people who've never thought about motion-to-photon
   latency. Press L: injected lag ramps smoothly from 0 → 250 ms over ~30 s while
   you try to track the target. The gradual degradation is viscerally
   uncomfortable — and then warp snaps on and the relief is instant and physical.

   It's deliberately thin: it just drives the SAME injected-lag slider the panel
   uses (so the HUD, label and LagSim all stay in sync), then calls the shared
   setWarp() for the relief. Press L again to cancel; toggling W mid-ramp counts
   as early relief.
--------------------------------------------------------------------------- */

export function installFeelTheLag(ctx) {
  const slLag = document.getElementById('sl-lag');
  const hudLag = document.getElementById('hud-lag');
  const banner = document.getElementById('lag-banner');

  const RAMP_MS = 30000;  // 0 → 250 ms over half a minute
  const MAX_LAG = 250;
  const REST_LAG = 150;   // the default no-warp lag to restore on cancel

  let raf = 0;
  let startT = 0;
  let active = false;

  function setLag(ms) {
    const v = Math.round(ms);
    slLag.value = String(v);
    slLag.dispatchEvent(new Event('input', { bubbles: true })); // → lag.lagMs + label
    if (hudLag) hudLag.textContent = v + ' ms';                 // keep HUD live
  }
  function showBanner(text) { if (banner) { banner.textContent = text; banner.classList.add('show'); } }
  function hideBanner() { banner?.classList.remove('show'); }

  function tick(now) {
    if (!active) return;
    const t = Math.min(1, (now - startT) / RAMP_MS);
    setLag(t * MAX_LAG);
    showBanner(`Feel the lag — ${Math.round(t * MAX_LAG)} ms and climbing…`);
    if (t < 1) raf = requestAnimationFrame(tick);
    else relief();
  }

  function relief() {
    active = false;
    cancelAnimationFrame(raf);
    ctx.setWarp(true); // snaps injected lag to 50 ms (+ its pulse/SFX) — the relief
    showBanner('Frame Warp ON — instant relief.');
    setTimeout(hideBanner, 2600);
  }

  function start() {
    if (ctx.getWarpEnabled()) ctx.setWarp(false); // make sure the lag is felt
    active = true;
    startT = performance.now();
    raf = requestAnimationFrame(tick);
    console.log('[FrameWarp] feel-the-lag ramp STARTED');
  }
  function stop() {
    active = false;
    cancelAnimationFrame(raf);
    hideBanner();
    setLag(REST_LAG);
    console.log('[FrameWarp] feel-the-lag ramp CANCELLED');
  }

  // Toggling warp by hand during the ramp = early relief (stop fighting the lag).
  window.addEventListener('framewarp:warp', (e) => {
    if (active && e.detail.on) {
      active = false;
      cancelAnimationFrame(raf);
      showBanner('Frame Warp ON — instant relief.');
      setTimeout(hideBanner, 2600);
    }
  });

  return { toggle() { active ? stop() : start(); } };
}
