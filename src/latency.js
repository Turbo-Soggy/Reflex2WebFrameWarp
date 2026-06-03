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

   We track two series so the chart can show the gap the warp removes:

     • noWarp: the orientation the 3D frame was rendered with came from an input
       sample taken `renderedInputTime` ago, so its latency = now -
       renderedInputTime  (≈ injected lag + frame wait).

     • warp: when warp is on, it re-applies the freshest input every display
       refresh, so the shown view direction is at most one display frame old —
       its latency = the measured composite frame interval (≈ 16 ms at 60 Hz).

   Both numbers are derived from real recorded timestamps, and both behave
   sensibly whether the camera is moving or idle.
--------------------------------------------------------------------------- */

export class Latency {
  constructor(maxSamples = 240) {
    this.maxSamples = maxSamples;
    this.noWarp = [];   // ring buffer of no-warp latency samples (ms)
    this.warp = [];     // ring buffer of warp latency samples (ms)

    this.renderedInputTime = performance.now();
    this._lastCompositeNow = performance.now();

    // Smoothed values for the HUD text (the chart uses the raw buffers).
    // null = not yet initialized (so a legitimate 0 ms isn't mistaken for it).
    this.smoothNoWarp = null;
    this.smoothWarp = null;
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

    const noWarp = now - this.renderedInputTime;
    const warp = warpEnabled ? frameInterval : noWarp;

    this._push(this.noWarp, noWarp);
    this._push(this.warp, warp);

    // Exponential smoothing for a steady on-screen readout.
    const a = 0.1;
    this.smoothNoWarp = this.smoothNoWarp === null ? noWarp : this.smoothNoWarp * (1 - a) + noWarp * a;
    this.smoothWarp = this.smoothWarp === null ? warp : this.smoothWarp * (1 - a) + warp * a;

    return { noWarp, warp };
  }

  _push(buf, v) {
    buf.push(v);
    if (buf.length > this.maxSamples) buf.shift();
  }
}
