/* ---------------------------------------------------------------------------
   bench/foveation-budget.js — Vector 2: how much can we foveate the margins?
   ---------------------------------------------------------------------------
   Before writing a single foveation shader, measure the constraint. The guard
   band is the warp RESERVE; foveally crushing it is safe only to the extent
   that crushed (margin-sourced) pixels stay OUT of the fovea. This replays the
   real trace mix through the deterministic sim (the same instrument that
   validated everything else) and reports, per trace × guard policy:

     • margin draw   — what fraction of the displayed viewport gets sourced from
                       the guard margin (mean / p95 / max over the trace).
     • min eccentricity — the CLOSEST the margin strip's inner edge ever gets to
                       the view centre, in degrees. Bigger = safer to foveate.
     • fovea reached? — did the margin ever enter the central ±FOVEA_DEG?
     • clamp rate / pixel cost — context (edge-clamp failures; bits to reclaim).

   Run:  node bench/foveation-budget.js
--------------------------------------------------------------------------- */

import { synthConstantVelocity, synthSineSweep, synthWander, synthFlick } from '../src/replay/trace.js';
import { simulate, displayFovX, DEFAULT_CONFIG } from '../src/replay/pipeline-sim.js';
import { makeAdaptiveGuardPolicy } from '../src/replay/adaptive-guard.js';
import { marginViewportFraction, marginInnerEccentricityDeg } from '../src/replay/foveation.js';
import { percentile } from '../src/cloud/cloud-recorder.js';

const RAD = Math.PI / 180;
const FOVEA_HALF_UV = 0.10;                         // "fovea" = central 20% of the view
const fovXDeg = displayFovX(DEFAULT_CONFIG) / RAD;
const FOVEA_DEG = FOVEA_HALF_UV * fovXDeg;          // its eccentricity in degrees

// The same workload mix as bench/adaptive.js, plus a hard flick (the saccade-
// like case). All deterministic.
const traces = [
  synthSineSweep({ amplitudeDeg: 10, freqHz: 0.2, durationMs: 10000 }),  // calm tracking
  synthSineSweep({ amplitudeDeg: 30, freqHz: 0.5, durationMs: 10000 }),  // brisk tracking
  synthConstantVelocity({ degPerSec: 150, durationMs: 10000 }),          // hot (past fixed-0.12 onset)
  synthWander({ seed: 1, intensity: 1, durationMs: 10000 }),
  synthWander({ seed: 2, intensity: 2, durationMs: 10000 }),
  synthFlick({ stepDeg: 40, atMs: 1000, durationMs: 4000 }),             // saccade-like flick
];

const policies = [
  { name: 'fixed-0.12', config: { guard: 0.12 } },
  { name: 'adaptive', config: { guardPolicy: makeAdaptiveGuardPolicy() } },
];

const pct = x => (100 * x).toFixed(1);
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log(`Vector 2 foveation budget — horizontal FOV ${fovXDeg.toFixed(1)}°, ` +
  `"fovea" = central ±${FOVEA_DEG.toFixed(1)}°\n`);
console.log([
  pad('trace', 22), pad('policy', 12),
  padL('margin% mean', 12), padL('p95', 6), padL('max', 6),
  padL('min ecc°', 9), padL('fovea?', 7), padL('clamp%', 8), padL('pixel×', 7),
].join(' '));

for (const trace of traces) {
  for (const p of policies) {
    const r = simulate(trace, p.config);
    const ticks = r.ticks.filter(k => k.t >= r.config.warmupMs);
    const fracs = ticks.map(k => marginViewportFraction(k.guardUsed, k.guard));
    const eccs = ticks.map(k => marginInnerEccentricityDeg(k.guardUsed, k.guard, r.config));
    const maxFrac = fracs.reduce((a, b) => Math.max(a, b), 0);
    const minEcc = eccs.reduce((a, b) => Math.min(a, b), Infinity);
    const foveaReached = minEcc < FOVEA_DEG;
    console.log([
      pad(trace.name, 22), pad(p.name, 12),
      padL(pct(fracs.reduce((a, b) => a + b, 0) / fracs.length), 12),
      padL(pct(percentile(fracs, 95)), 6),
      padL(pct(maxFrac), 6),
      padL(minEcc.toFixed(1), 9),
      padL(foveaReached ? 'YES' : 'no', 7),
      padL(pct(r.summary.clampRate), 8),
      padL(r.summary.pixelCost.mean.toFixed(2), 7),
    ].join(' '));
  }
  console.log('');
}

console.log('margin% = fraction of the displayed view sourced from the crushed margin');
console.log('min ecc° = closest the margin strip ever gets to view centre (bigger = safer to foveate)');
console.log(`fovea? = did the margin ever enter the central ±${FOVEA_DEG.toFixed(1)}°  (no eye tracker → gaze assumed at view centre)`);
