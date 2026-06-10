/* ---------------------------------------------------------------------------
   cloud-recorder.js — CSV capture for the cloud demo (Stage C5)
   ---------------------------------------------------------------------------
   Same R/E workflow as the local demo's recorder.js (which this extends), with
   the cloud experiment's columns and a per-mode summary block appended to the
   export — so a single CSV is a defensible experimental result on its own:
   rows for the raw samples, then mean/p95/p99 of the PERCEIVED view-direction
   latency for each mode (warp off = the end-to-end input→photon loop; warp on
   = the local composite interval the warp reduces it to).

   The headline thesis figure comes from sweeping the delay slider while
   recording: e2e latency tracks the injected delay linearly, the warp line
   stays flat at display-frame time. net_delay_ms / jitter_on are stamped on
   every row (they ride in on the pose packets), so the sweep needs no manual
   bookkeeping.
--------------------------------------------------------------------------- */

import { Recorder } from '../recorder.js';

const COLUMNS = [
  'time_ms',          // ms since this recording started
  'warp_enabled',     // client reprojection on?
  'net_delay_ms',     // one-way simulated network delay SETTING at capture
  'jitter_on',        // jitter switch state at capture
  'e2e_no_warp_ms',   // measured input→displayed-frame loop (the network cost)
  'warp_view_ms',     // measured view-direction latency with the warp applied
];

/**
 * p-th percentile by the nearest-rank method (exact sample, no interpolation —
 * easy to defend in a report). `values` need not be sorted.
 */
export function percentile(values, p) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export class CloudRecorder extends Recorder {
  constructor() {
    super();
    this.filePrefix = 'framewarp-cloud';
  }

  /** One row per composite frame while recording (mirrors Recorder.capture). */
  capture(now, s) {
    if (!this.recording) return;
    this.rows.push([
      Math.round(now - this._t0),
      s.warpEnabled ? 1 : 0,
      Math.round(s.netDelayMs),
      s.jitterOn ? 1 : 0,
      s.noWarpMs.toFixed(2),
      s.warpMs.toFixed(2),
    ]);
  }

  toCSV() {
    const lines = [COLUMNS.join(',')];
    for (const r of this.rows) lines.push(r.join(','));

    // Per-mode summary of the latency the player actually PERCEIVES:
    // warp off → the e2e column; warp on → the warped-view column.
    lines.push('');
    lines.push('# summary: perceived view-direction latency per mode');
    lines.push('# mode,samples,mean_ms,p95_ms,p99_ms');
    for (const [mode, flag, col] of [['warp_off', 0, 4], ['warp_on', 1, 5]]) {
      const vals = this.rows.filter((r) => r[1] === flag).map((r) => parseFloat(r[col]));
      if (vals.length === 0) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      lines.push(`# ${mode},${vals.length},${mean.toFixed(2)},` +
        `${percentile(vals, 95).toFixed(2)},${percentile(vals, 99).toFixed(2)}`);
    }
    return lines.join('\n');
  }
}
