/* ---------------------------------------------------------------------------
   bench/adaptive.js — Option C evaluation: fixed vs adaptive guard band
   ---------------------------------------------------------------------------
   The trade-off under test (THEORY.md §3 inverted): a bigger margin costs
   GPU pixels quadratically (1/uScale²) and buys clamp-free headroom; a fixed
   margin pays that cost all the time for the worst case. The adaptive policy
   (src/replay/adaptive-guard.js) pays it only when recent motion says so.

   Run:   node bench/adaptive.js [--out bench/out/adaptive.csv]
   Emits one row per (trace × policy): pixel cost, clamp rate, residual error.
--------------------------------------------------------------------------- */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { synthConstantVelocity, synthSineSweep, synthWander } from '../src/replay/trace.js';
import { simulate } from '../src/replay/pipeline-sim.js';
import { makeAdaptiveGuardPolicy } from '../src/replay/adaptive-guard.js';

const out = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1] : null;

// The workload mix: calm tracking, brisk tracking, a hot flick burst, and
// seeded "realistic" wander at two intensities. All deterministic.
const traces = [
  synthSineSweep({ amplitudeDeg: 10, freqHz: 0.2, durationMs: 10000 }),  // calm: peak ~12.6°/s
  synthSineSweep({ amplitudeDeg: 30, freqHz: 0.5, durationMs: 10000 }),  // brisk: peak ~94°/s
  synthConstantVelocity({ degPerSec: 150, durationMs: 10000 }),          // hot: past fixed-0.12 onset
  synthWander({ seed: 1, intensity: 1, durationMs: 10000 }),
  synthWander({ seed: 2, intensity: 2, durationMs: 10000 }),
];

const policies = [
  { name: 'fixed-0.04', config: { guard: 0.04 } },
  { name: 'fixed-0.08', config: { guard: 0.08 } },
  { name: 'fixed-0.12', config: { guard: 0.12 } },
  { name: 'adaptive', config: { guardPolicy: makeAdaptiveGuardPolicy() } },
];

const rows = ['trace,policy,guard_mean,pixel_cost_mean,clamp_rate,err_warp_p95_deg,err_warp_max_deg'];
for (const trace of traces) {
  for (const p of policies) {
    const { summary: s } = simulate(trace, p.config);
    rows.push([trace.name, p.name, s.guard.mean.toFixed(4), s.pixelCost.mean.toFixed(4),
      s.clampRate.toFixed(6), s.errWarpDeg.p95.toFixed(4), s.errWarpDeg.max.toFixed(4)].join(','));
  }
  rows.push(''); // blank line between trace groups for readability
}
rows.push('# pixel_cost 1.0 = rendering exactly what is displayed (no guard band)');

const csv = rows.join('\n') + '\n';
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, csv);
  console.log(`wrote ${out}`);
} else {
  process.stdout.write(csv);
}
