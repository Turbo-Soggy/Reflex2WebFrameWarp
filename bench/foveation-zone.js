/* ---------------------------------------------------------------------------
   bench/foveation-zone.js — Vector 2: the fovea-safe RECTANGULAR static core
   ---------------------------------------------------------------------------
   "Lock the geometry." A STATIC encoded crush zone slides around in visual
   angle as the warp shifts, so a core is fovea-safe only if its CLOSEST crushed
   texel — over the real trace mix, worst case — stays past the foveal radius.

   Key structural fact: the two axes are independent. crushInnerEccentricityDeg
   for X depends only on (cb_x, duX, fovX), for Y only on (cb_y, duY, fovY), and
   "both axes safe" = "X safe AND Y safe". So the optimum is two 1-D searches,
   not a 2-D sweep: the smallest MB-aligned half-width per axis that survives.
   The vertical FOV is smaller, so the SAME fractional crush is fewer degrees
   vertically — the core must be taller than wide (cb_y > cb_x) to balance.

   The crush-area column is a GEOMETRIC upper bound on bitrate saving (area
   squashed), NOT bits — real ΔR ≤ this and needs the WebCodecs harness.

   Run:  node bench/foveation-zone.js
--------------------------------------------------------------------------- */

import { synthConstantVelocity, synthSineSweep, synthWander, synthFlick } from '../src/replay/trace.js';
import { simulate, displayFovX, DEFAULT_CONFIG } from '../src/replay/pipeline-sim.js';
import { crushInnerEccentricityDeg } from '../src/replay/foveation.js';

const RAD = Math.PI / 180;
const GUARD = 0.12;
const fovXDeg = displayFovX(DEFAULT_CONFIG) / RAD;
const fovYDeg = DEFAULT_CONFIG.displayFovYDeg;
const FOVEA_DEG = 0.10 * fovXDeg;                     // central ±10.8° of visual angle

const traces = [
  synthSineSweep({ amplitudeDeg: 10, freqHz: 0.2, durationMs: 10000 }),
  synthSineSweep({ amplitudeDeg: 30, freqHz: 0.5, durationMs: 10000 }),
  synthConstantVelocity({ degPerSec: 150, durationMs: 10000 }),
  synthWander({ seed: 1, intensity: 1, durationMs: 10000 }),
  synthWander({ seed: 2, intensity: 2, durationMs: 10000 }),
  synthFlick({ stepDeg: 40, atMs: 1000, durationMs: 4000 }),
];

const sims = traces.map((t) => {
  const r = simulate(t, { guard: GUARD });
  return { name: t.name, ticks: r.ticks.filter((k) => k.t >= r.config.warmupMs) };
});

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

// Worst-over-traces eccentricity for one axis at one half-width.
function worstEcc(cb, duSel, fovDeg) {
  let worst = Infinity, binder = '';
  for (const s of sims) {
    let m = Infinity;
    for (const k of s.ticks) {
      const e = crushInnerEccentricityDeg(cb, GUARD, duSel(k), fovDeg);
      if (e < m) m = e;
    }
    if (m < worst) { worst = m; binder = s.name; }
  }
  return { worst, binder };
}

// Sweep candidates large→small; the last safe one is the smallest safe (ecc is
// monotonic in cb). Print the search so the boundary is visible, not asserted.
function axisSearch(title, candidates, duSel, fovDeg) {
  console.log(`\n${title} axis (FOV ${fovDeg.toFixed(1)}°):`);
  console.log(['  ' + pad('core', 14), padL('worst ecc°', 11), padL('safe', 6), padL('binds on', 16)].join(' '));
  let smallestSafe = null;
  for (const c of candidates) {
    const { worst, binder } = worstEcc(c.cb, duSel, fovDeg);
    const safe = worst >= FOVEA_DEG;
    if (safe) smallestSafe = { ...c, worst };
    console.log(['  ' + pad(c.label, 14), padL(Number.isFinite(worst) ? worst.toFixed(1) : '∞', 11),
      padL(safe ? 'yes' : 'NO', 6), padL(binder, 16)].join(' '));
  }
  return smallestSafe;
}

// MB-aligned candidates: cols = 40 ∓ j (cb_x = j/80); rows = r0..45−r0 (cb_y = (22.5−r0)/45).
const xCands = [];
for (let j = 24; j >= 10; j--) xCands.push({ cb: j / 80, label: `cols ${40 - j}-${40 + j}` });
const yCands = [];
for (let r0 = 6; r0 <= 18; r0++) yCands.push({ cb: (22.5 - r0) / 45, label: `rows ${r0}-${45 - r0}` });

console.log(`Vector 2 — fovea-safe rectangular core  (guard ${GUARD}, FOV ${fovXDeg.toFixed(1)}°×${fovYDeg}°, ` +
  `fovea ±${FOVEA_DEG.toFixed(1)}°)`);

const bx = axisSearch('Horizontal', xCands, (k) => k.duX, fovXDeg);
const by = axisSearch('Vertical', yCands, (k) => k.duY, fovYDeg);

const areaRect = (1 - (2 * bx.cb) * (2 * by.cb)) * 100;
const areaSquare = (1 - 0.6 * 0.6) * 100; // cols 16-64 square baseline

console.log('\n──────────────────────────────────────────────────────────────');
console.log(`Optimal fovea-safe RECTANGULAR core:  ${bx.label}  ×  ${by.label}`);
console.log(`  horizontal worst ${bx.worst.toFixed(1)}° · vertical worst ${by.worst.toFixed(1)}°  (fovea ±${FOVEA_DEG.toFixed(1)}°)`);
console.log(`  crush area ${areaRect.toFixed(0)}%  vs  square cols 16-64 ${areaSquare.toFixed(0)}%   (geometric upper bound on saving)`);
console.log('\ncrush area = area squashed; real ΔR ≤ this (bits≠pixels → WebCodecs harness)');
console.log('fovea assumes gaze at view centre (no eye tracker)');
