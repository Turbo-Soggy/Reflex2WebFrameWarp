/* ---------------------------------------------------------------------------
   recorder.js — Capture latency data and export it as CSV
   ---------------------------------------------------------------------------
   Turns the demo into an experiment. Press R to start/stop a recording session;
   while recording, every composite frame appends one row of measured data.
   Press E to download the session as a .csv you can chart in the report.

   This is what makes the report's figures "experimental results" rather than
   "screenshots of the HUD": the numbers are real, timestamped, and reproducible.
--------------------------------------------------------------------------- */

const COLUMNS = [
  'time_ms',            // ms since this recording started
  'warp_enabled',       // reprojection on? (lag is always on — the simulated condition)
  'injected_lag_ms',    // the LagSim.lagMs setting at capture time
  'source_hz',          // source render-rate cap at capture time
  'guard_pct',            // guard-band margin (%) at capture time
  'no_warp_latency_ms',   // measured view-direction latency without warp
  'warp_latency_ms',      // measured view-direction latency with warp
];

export class Recorder {
  constructor() {
    this.recording = false;
    this.rows = [];
    this._t0 = 0;
  }

  /** Start (clears previous) or stop recording. Returns the new state. */
  toggle(now) {
    this.recording = !this.recording;
    if (this.recording) {
      this.rows = [];
      this._t0 = now;
    }
    return this.recording;
  }

  /** Append one sample if recording. `s` is a plain object of column values. */
  capture(now, s) {
    if (!this.recording) return;
    this.rows.push([
      Math.round(now - this._t0),
      s.warpEnabled ? 1 : 0,
      Math.round(s.injectedLagMs),
      Math.round(s.sourceHz),
      Math.round(s.guardPct),
      s.noWarpMs.toFixed(2),
      s.warpMs.toFixed(2),
    ]);
  }

  get sampleCount() { return this.rows.length; }

  toCSV() {
    const lines = [COLUMNS.join(',')];
    for (const r of this.rows) lines.push(r.join(','));
    return lines.join('\n');
  }

  /** Trigger a browser download of the captured data (client-side, no server). */
  download() {
    if (this.rows.length === 0) {
      console.warn('[FrameWarp] nothing recorded yet — press R to start a capture');
      return;
    }
    const blob = new Blob([this.toCSV()], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `framewarp-latency-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    console.log(`[FrameWarp] exported ${this.rows.length} samples to CSV`);
  }
}
