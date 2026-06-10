/* ---------------------------------------------------------------------------
   bench/run.js — Headless benchmark CLI (no browser, no GPU, no human)
   ---------------------------------------------------------------------------
   Replays an input trace through a pipeline configuration and writes a CSV.
   This is the roadmap's "headless benchmark mode": thousands of controlled
   runs are a for-loop in a shell script, and every run is bit-reproducible.

   Examples (from the repo root):

     # a recorded trace (press T in the demo to record one) through 80 ms lag
     node bench/run.js --trace traces/sweep.json --lag 80 --out out.csv

     # synthetic 150 deg/s constant rotation, default pipeline
     node bench/run.js --synth constant --deg-per-sec 150 --out out.csv

     # seeded wander, 10 s, tighter guard band
     node bench/run.js --synth wander --seed 7 --duration 10000 --guard 0.08

     # clamp-onset sweep: one summary row per velocity + the analytic bounds
     # (the predicted-vs-measured figure for the theory doc)
     node bench/run.js --sweep-velocity 60:260:5 --out sweep.csv

   Omit --out to print to stdout.
--------------------------------------------------------------------------- */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  validateTrace, synthConstantVelocity, synthSineSweep, synthFlick, synthWander,
} from '../src/replay/trace.js';
import {
  simulate, resultToCSV, clampOnsetBoundsDegPerSec, DEFAULT_CONFIG,
} from '../src/replay/pipeline-sim.js';

// --- tiny flag parser (--name value) ----------------------------------------
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
    else args[key] = true;
  }
}
const num = (key, fallback) => (args[key] !== undefined ? parseFloat(args[key]) : fallback);

const config = {
  displayHz: num('display-hz', DEFAULT_CONFIG.displayHz),
  renderHz: num('render-hz', DEFAULT_CONFIG.renderHz),
  lagMs: num('lag', DEFAULT_CONFIG.lagMs),
  guard: num('guard', DEFAULT_CONFIG.guard),
  displayFovYDeg: num('fov', DEFAULT_CONFIG.displayFovYDeg),
  warmupMs: num('warmup', DEFAULT_CONFIG.warmupMs),
};

function emit(text) {
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, text);
    console.log(`wrote ${args.out}`);
  } else {
    process.stdout.write(text);
  }
}

// --- Mode 1: velocity sweep (predicted vs measured clamp onset) --------------
if (args['sweep-velocity']) {
  const [from, to, step] = args['sweep-velocity'].split(':').map(parseFloat);
  const bounds = clampOnsetBoundsDegPerSec(config);
  const rows = ['deg_per_sec,clamp_rate,err_warp_p95_deg,err_nowarp_p95_deg,guard_used_max'];
  for (let v = from; v <= to; v += step) {
    const trace = synthConstantVelocity({ degPerSec: v, durationMs: num('duration', 5000) });
    const { summary: s } = simulate(trace, config);
    rows.push([v, s.clampRate.toFixed(6), s.errWarpDeg.p95.toFixed(4),
      s.errNoWarpDeg.p95.toFixed(4), s.guardUsed.max.toFixed(4)].join(','));
  }
  rows.push('#',
    `# analytic clamp-onset bounds (deg/s): lower=${bounds.lowerDegPerSec.toFixed(2)}` +
    ` upper=${bounds.upperDegPerSec.toFixed(2)} (max warp ${bounds.maxWarpDeg.toFixed(2)} deg)`,
    `# config,lagMs=${config.lagMs},renderHz=${config.renderHz},displayHz=${config.displayHz},guard=${config.guard}`);
  emit(rows.join('\n') + '\n');
  process.exit(0);
}

// --- Mode 2: single trace → per-tick CSV -------------------------------------
let trace;
if (args.trace) {
  trace = validateTrace(JSON.parse(readFileSync(args.trace, 'utf8')));
} else {
  const duration = num('duration', 5000);
  switch (args.synth) {
    case 'constant':
      trace = synthConstantVelocity({ durationMs: duration, degPerSec: num('deg-per-sec', 90) });
      break;
    case 'sine':
      trace = synthSineSweep({ durationMs: duration, amplitudeDeg: num('amplitude', 30), freqHz: num('freq', 0.5) });
      break;
    case 'flick':
      trace = synthFlick({ durationMs: duration, stepDeg: num('step', 40), atMs: num('at', 1000) });
      break;
    case 'wander':
      trace = synthWander({ durationMs: duration, seed: num('seed', 1), intensity: num('intensity', 1) });
      break;
    default:
      console.error('usage: node bench/run.js (--trace file.json | --synth constant|sine|flick|wander)\n' +
        '       [--lag ms] [--render-hz n] [--display-hz n] [--guard f] [--fov deg]\n' +
        '       [--duration ms] [--deg-per-sec v] [--seed n] [--out file.csv]\n' +
        '       or: --sweep-velocity from:to:step');
      process.exit(1);
  }
}

emit(resultToCSV(simulate(trace, config)));
