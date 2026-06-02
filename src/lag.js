/* ---------------------------------------------------------------------------
   lag.js — Artificial motion-to-photon lag simulation
   ---------------------------------------------------------------------------
   THE PROBLEM WE'RE DEMONSTRATING:

   "Motion-to-photon latency" = the time between you physically moving the
   mouse and the photons on screen actually reflecting that movement.

   Two things create this delay at a low frame rate:
     1. PRESENTATION delay — even if input were instant, a 30 FPS display only
        refreshes every ~33 ms, so on average your motion waits ~16 ms just to
        be shown.
     2. PIPELINE delay — real engines sample input, simulate, render, and queue
        the frame for display. Each stage holds the input a little longer.

   To make this *visible and tunable* for the demo, we don't just throttle the
   render loop — we also feed the renderer an orientation from slightly in the
   PAST. We keep a short ring buffer of timestamped orientation snapshots and,
   each frame, render the one that is `lagMs` old.

   This is what the Stage 2 warp shader will later cancel out: it takes this
   old frame and reprojects it using the freshest input.
--------------------------------------------------------------------------- */

export class LagSim {
  /**
   * @param {number} renderHz  How often we allow a redraw (30 = 30 FPS).
   * @param {number} lagMs     Extra pipeline latency to inject, in ms.
   */
  constructor(renderHz = 30, lagMs = 80) {
    this.renderInterval = 1000 / renderHz; // ms between allowed frames
    this.lagMs = lagMs;

    this._lastRenderTime = -Infinity;

    // Ring buffer of { t, yaw, pitch } orientation snapshots.
    this.history = [];
    this.maxHistoryMs = 1000; // keep at most ~1s of history
  }

  /** Record the latest orientation snapshot at time `now` (ms). */
  record(now, snapshot) {
    this.history.push({ t: now, yaw: snapshot.yaw, pitch: snapshot.pitch });

    // Drop anything older than we'd ever need.
    const cutoff = now - this.maxHistoryMs;
    while (this.history.length > 1 && this.history[0].t < cutoff) {
      this.history.shift();
    }
  }

  /**
   * Should we render a new frame this tick? Enforces the 30 FPS source cap.
   * (The cap is always on — it's the demand we're simulating, not a toggle.)
   *
   * NOTE on accuracy: we can only ever render on an animation-frame tick, and
   * those arrive at the *display's* refresh rate (60/120/165 Hz...). If we just
   * reset the timer to `now` each render, we'd skip whole ticks and land on
   * refreshRate/N — e.g. 24 FPS on a 48 Hz tick, never a clean 30. Instead we
   * advance the deadline by exactly one interval, so the long-run average locks
   * to 30 FPS even though individual frames jitter by a tick.
   */
  shouldRender(now) {
    if (now - this._lastRenderTime >= this.renderInterval) {
      this._lastRenderTime += this.renderInterval;
      // If we've fallen far behind (tab was backgrounded, a long stall), don't
      // try to "catch up" with a burst of frames — resync to now.
      if (now - this._lastRenderTime > this.renderInterval) {
        this._lastRenderTime = now;
      }
      return true;
    }
    return false;
  }

  /**
   * Which orientation should actually be drawn this frame? Always the snapshot
   * from `lagMs` ago — the deliberately-delayed view the warp later compensates.
   */
  orientationToRender(now) {
    if (this.history.length === 0) return { yaw: 0, pitch: 0 };

    const targetTime = now - this.lagMs;

    // Find the newest snapshot at or before targetTime.
    let chosen = this.history[0];
    for (let i = 0; i < this.history.length; i++) {
      if (this.history[i].t <= targetTime) chosen = this.history[i];
      else break;
    }
    return chosen;
  }

  /** Change the source frame-rate cap at runtime (used by the parameter panel). */
  setRenderHz(hz) {
    this.renderInterval = 1000 / hz;
    this._lastRenderTime = -Infinity;
  }
}
