/* ---------------------------------------------------------------------------
   hud.js — Live stats overlay
   ---------------------------------------------------------------------------
   Reads counters from the render loop once per second and writes them into the
   DOM. Kept totally separate from rendering so it can't affect frame timing.

   Stage 2 tracks TWO frame rates that tell the whole story:
     • Source FPS   — how often the 3D scene is actually redrawn (capped ~30).
     • Warp FPS     — how often we reproject + present to screen (display rate).
   The gap between them is the latency the warp hides.
--------------------------------------------------------------------------- */

export class HUD {
  constructor() {
    this.el = {
      mode: document.getElementById('hud-mode'),
      lag: document.getElementById('hud-lag'),
      source: document.getElementById('hud-source'),
      warp: document.getElementById('hud-warp'),
      inputrate: document.getElementById('hud-inputrate'),
      latency: document.getElementById('hud-latency'),
    };

    this._sceneFrames = 0;
    this._compositeFrames = 0;
    this._pendingInputEvents = 0;
    this._lastFlush = performance.now();
  }

  /** Call when the 3D scene is redrawn into the texture (the slow clock). */
  countSceneFrame() { this._sceneFrames++; }

  /** Call when a warped frame is presented to screen (the fast clock). */
  countCompositeFrame() { this._compositeFrames++; }

  /** Feed the input event count drained from the Input sampler this tick. */
  addInputEvents(n) { this._pendingInputEvents += n; }

  /** Refresh the on-screen text. Cheap to call every frame (DOM touched ~1 Hz). */
  update(now, { warpEnabled, motionVectorsOn, injectedLagMs, noWarpMs, warpMs }) {
    const dt = now - this._lastFlush;
    if (dt < 1000) return;

    const sourceFps = (this._sceneFrames * 1000) / dt;
    const warpFps = (this._compositeFrames * 1000) / dt;
    const inputHz = (this._pendingInputEvents * 1000) / dt;

    // Lag is always on (it's the simulated condition); warp is the only toggle.
    this.el.mode.textContent =
      (warpEnabled ? 'Frame Warp: ON' : 'Frame Warp: OFF') + ` · MV: ${motionVectorsOn ? 'ON' : 'OFF'}`;
    this.el.mode.style.color = warpEnabled ? 'var(--accent)' : 'var(--warn)';

    this.el.lag.textContent = injectedLagMs.toFixed(0) + ' ms';
    this.el.source.textContent = sourceFps.toFixed(0) + ' FPS';
    this.el.warp.textContent = warpFps.toFixed(0) + ' FPS';
    this.el.inputrate.textContent = inputHz.toFixed(0) + ' Hz';
    // Measured view-direction latency: without warp → with warp.
    this.el.latency.textContent =
      `${noWarpMs.toFixed(0)} → ${warpMs.toFixed(0)} ms`;

    this._sceneFrames = 0;
    this._compositeFrames = 0;
    this._pendingInputEvents = 0;
    this._lastFlush = now;
  }
}

/* ---------------------------------------------------------------------------
   Scoreboard — the shooter's hit/miss counters + crosshair feedback
   ---------------------------------------------------------------------------
   This is the part a non-technical judge reads in one second. Each click is
   scored into the bucket for the current warp MODE (with-warp vs without-warp),
   and a "hitmarker" (green ✓) or "miss" (red ✗) flashes at the crosshair. The
   two tallies persist so the comparison survives toggling W.
--------------------------------------------------------------------------- */
export class Scoreboard {
  constructor() {
    this.el = {
      statsOff: document.getElementById('stats-off'), // WITHOUT warp
      statsOn: document.getElementById('stats-on'),   // WITH warp
      fb: document.getElementById('feedback'),
    };
    this.off = { hits: 0, misses: 0 };
    this.on = { hits: 0, misses: 0 };
    this._fbTimer = null;
    this._render();
  }

  /** Record one shot into the bucket for the current warp mode, flash feedback. */
  registerShot(warpOn, isHit) {
    const bucket = warpOn ? this.on : this.off;
    if (isHit) bucket.hits++; else bucket.misses++;
    this._render();
    this._flash(isHit);
  }

  /** Highlight whichever mode is currently active (called when W toggles). */
  setActiveMode(warpOn) {
    this.el.statsOn.classList.toggle('active', warpOn);
    this.el.statsOff.classList.toggle('active', !warpOn);
  }

  reset() {
    this.off = { hits: 0, misses: 0 };
    this.on = { hits: 0, misses: 0 };
    this._render();
  }

  _render() {
    this.el.statsOff.innerHTML = statsHTML('WITHOUT WARP', this.off);
    this.el.statsOn.innerHTML = statsHTML('WITH WARP', this.on);
  }

  _flash(isHit) {
    const fb = this.el.fb;
    fb.textContent = isHit ? '✓' : '✗';
    fb.className = 'feedback ' + (isHit ? 'hit' : 'miss');
    // Re-trigger the CSS animation even on rapid repeat clicks.
    void fb.offsetWidth;
    fb.classList.add('show');
    clearTimeout(this._fbTimer);
    this._fbTimer = setTimeout(() => fb.classList.remove('show'), 360);
  }
}

/* A slim single line: LABEL — N hits · M misses · A% accuracy. */
function statsHTML(label, { hits, misses }) {
  const shots = hits + misses;
  const acc = shots ? Math.round((hits / shots) * 100) : 0;
  return `<span class="st-label">${label}</span>` +
         `<span class="st-dim"> — </span>${hits} hits` +
         `<span class="st-dim"> · </span>${misses} miss` +
         `<span class="st-dim"> · </span><span class="st-acc">${acc}%</span>`;
}
