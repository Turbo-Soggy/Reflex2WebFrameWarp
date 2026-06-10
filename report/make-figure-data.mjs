/* ---------------------------------------------------------------------------
   report/make-figure-data.mjs — emit the CSVs behind the report figures
   ---------------------------------------------------------------------------
   Every figure in the report is generated from the replay instrument, not
   from screenshots — re-run this then make-figures.py to regenerate them
   bit-identically:

       node report/make-figure-data.mjs
       python report/make-figures.py

   Outputs (report/figures/):
     lag-sweep.csv    — view-direction latency vs injected pipeline delay
                        (the carrying figure: no-warp rises, warp flat)
     onset-sweep.csv  — clamp rate + residual error vs angular velocity,
                        with the analytic bounds (THEORY.md §3)
     adaptive.csv     — fixed vs adaptive guard band (Option C result)
--------------------------------------------------------------------------- */

import { writeFileSync, mkdirSync } from 'node:fs';
import { synthWander, synthConstantVelocity } from '../src/replay/trace.js';
import { simulate, clampOnsetBoundsDegPerSec } from '../src/replay/pipeline-sim.js';
import { makeAdaptiveGuardPolicy } from '../src/replay/adaptive-guard.js';

mkdirSync('report/figures', { recursive: true });

// --- Figure 1: the carrying figure ------------------------------------------
// View-direction latency vs injected delay. No-warp = the displayed frame's
// staleness (how old the orientation on screen is). Warp = one display
// interval (the compositor re-applies the freshest input every refresh) —
// flat by construction, and the simulator confirms zero residual error at
// this trace's velocities.
{
  const trace = synthWander({ seed: 1, durationMs: 10000 });
  const displayMs = 1000 / 60;
  const rows = ['lag_ms,nowarp_mean_ms,nowarp_p95_ms,warp_ms,warp_err_max_deg'];
  for (let lag = 20; lag <= 160; lag += 20) {
    const { summary: s } = simulate(trace, { lagMs: lag });
    rows.push([lag, s.stalenessMs.mean.toFixed(2), s.stalenessMs.p95.toFixed(2),
      displayMs.toFixed(2), s.errWarpDeg.max.toFixed(4)].join(','));
  }
  writeFileSync('report/figures/lag-sweep.csv', rows.join('\n') + '\n');
}

// --- Figure 2: guard-band exhaustion (theory vs instrument) -----------------
{
  const bounds = clampOnsetBoundsDegPerSec({});
  const rows = ['deg_per_sec,clamp_rate,err_warp_p95_deg'];
  for (let v = 60; v <= 260; v += 5) {
    const { summary: s } = simulate(synthConstantVelocity({ degPerSec: v, durationMs: 5000 }), {});
    rows.push([v, s.clampRate.toFixed(6), s.errWarpDeg.p95.toFixed(4)].join(','));
  }
  rows.push(`# lower,${bounds.lowerDegPerSec.toFixed(2)}`);
  rows.push(`# upper,${bounds.upperDegPerSec.toFixed(2)}`);
  writeFileSync('report/figures/onset-sweep.csv', rows.join('\n') + '\n');
}

// --- Figure 3: adaptive guard band (Option C) --------------------------------
{
  const traces = [
    ['calm', synthWander({ seed: 1, intensity: 0.4, durationMs: 10000 })],
    ['moderate', synthWander({ seed: 1, intensity: 1, durationMs: 10000 })],
    ['hot', synthWander({ seed: 2, intensity: 2, durationMs: 10000 })],
  ];
  const rows = ['trace,policy,pixel_cost,clamp_rate'];
  for (const [label, trace] of traces) {
    for (const [policy, config] of [
      ['fixed-0.12', { guard: 0.12 }],
      ['adaptive', { guardPolicy: makeAdaptiveGuardPolicy() }],
    ]) {
      const { summary: s } = simulate(trace, config);
      rows.push([label, policy, s.pixelCost.mean.toFixed(4), s.clampRate.toFixed(6)].join(','));
    }
  }
  writeFileSync('report/figures/adaptive.csv', rows.join('\n') + '\n');
}

console.log('wrote report/figures/{lag-sweep,onset-sweep,adaptive}.csv');
