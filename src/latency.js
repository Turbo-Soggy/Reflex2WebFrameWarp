/* ---------------------------------------------------------------------------
   latency.js — Real, timestamp-based latency measurement
   ---------------------------------------------------------------------------
   Stage 1's HUD showed a *theoretical* latency (injected lag + half a frame).
   Stage 3 measures it from actual `performance.now()` timestamps instead.

   We measure VIEW-DIRECTION latency: how stale the camera orientation shown on
   screen is, relative to the freshest sampled input. (True motion-to-photon
   also includes GPU queue + display scanout, which the browser can't observe
   without external hardware — so we're precise about calling this the
   view-direction component.)

     • LEFT half (no warp): shows the orientation the 3D frame was rendered
       with. That orientation came from an input sample taken `renderedInputTime`
       ago, so its latency = now - renderedInputTime  (≈ injected lag + frame wait).

     • RIGHT half (warp on): the warp re-applies the freshest input every display
       refresh, so the view direction it shows is at most one display frame old.
       Its latency = the measured composite frame interval (≈ 16 ms at 60 Hz).

   Both numbers are derived from real recorded timestamps, and both behave
   sensibly whether the camera is moving or idle.
--------------------------------------------------------------------------- */

export class Latency {
  constructor(maxSamples = 240) {
    this.maxSamples = maxSamples;
    this.left = [];   // ring buffer of left-half latency samples (ms)
    this.right = [];  // ring buffer of right-half latency samples (ms)

    this.renderedInputTime = performance.now();
    this._lastCompositeNow = performance.now();

    // Smoothed values for the HUD text (the chart uses the raw buffers).
    // null = not yet initialized (so a legitimate 0 ms isn't mistaken for it).
    this.smoothLeft = null;
    this.smoothRight = null;
  }

  /** Called when a 3D frame is rendered: pass the input timestamp it used. */
  markRender(inputTime) {
    if (typeof inputTime === 'number') this.renderedInputTime = inputTime;
  }

  /**
   * Called every composite (display refresh). Returns the two measured
   * latencies and pushes them into the ring buffers for the chart.
   */
  sample(now, warpEnabled) {
    const frameInterval = now - this._lastCompositeNow;
    this._lastCompositeNow = now;

    const left = now - this.renderedInputTime;
    const right = warpEnabled ? frameInterval : left;

    this._push(this.left, left);
    this._push(this.right, right);

    // Exponential smoothing for a steady on-screen readout.
    const a = 0.1;
    this.smoothLeft = this.smoothLeft === null ? left : this.smoothLeft * (1 - a) + left * a;
    this.smoothRight = this.smoothRight === null ? right : this.smoothRight * (1 - a) + right * a;

    return { left, right };
  }

  _push(buf, v) {
    buf.push(v);
    if (buf.length > this.maxSamples) buf.shift();
  }
}
