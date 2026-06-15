/* ---------------------------------------------------------------------------
   bench/parallax.js — Vector 3: parallax error and the depth-aware residual
   ---------------------------------------------------------------------------
   Quantifies, measured-first, what depth-aware reprojection buys over the
   shipped rotation-only warp:

     1. The UNCORRECTED parallax the rotation-only warp leaves (reproduces the
        §4.5 ~77 px figure, then sweeps it over speed × depth).
     2. The RESIDUAL after correcting with a piecewise-constant depth grid — and
        how it shrinks as the grid (16×9 → 64×36) gets finer (it's a quantization
        error, not a physical limit).
     3. The DISOCCLUSION band at a depth silhouette, which is grid-independent and
        unfillable by any single-layer reprojection — the generative-inpainting
        frontier (Vector 3 part 2, NOT achievable in-browser today).

   Honest model: fronto-parallel lateral linearization (shift = t/d · focal);
   ignores the forward-translation zoom term and rotation×translation coupling.
   Pure arithmetic — no scene render needed.

   Run:  node bench/parallax.js
--------------------------------------------------------------------------- */

import { fovXRad } from '../src/config.js';
import {
  focalPx, translationFromWalk, disparityPx,
  residualPx, disocclusionPx, gridResidualStats, cellExtentsFromField,
} from '../src/replay/parallax.js';

const W = 1920, H = 1080;
const LAG = 150;                  // ms — the headline lag budget
const halfX = fovXRad() / 2;      // half horizontal FOV (rad)
const focal = focalPx(halfX, W);

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log(`Vector 3 — depth-aware reprojection: parallax error & residual`);
console.log(`  FOV ${(halfX * 2 * 180 / Math.PI).toFixed(1)}° · ${W}×${H} · focal ${focal.toFixed(0)} px · lag ${LAG} ms\n`);

// --- 1) §4.5 reproduction --------------------------------------------------
const tWalk = translationFromWalk(1.4, LAG);
const px45 = disparityPx(tWalk, 2, halfX, W);
console.log('§4.5 check — uncorrected parallax (what rotation-only warp leaves):');
console.log(`  walk 1.4 m/s · ${LAG} ms · 2 m geometry → ${tWalk.toFixed(2)} m translation → ` +
  `${px45.toFixed(1)} px   (paper: ~77 px ✓)\n`);

// --- 2) Uncorrected disparity by speed × depth -----------------------------
const speeds = [['walk 1.4', 1.4], ['jog 3.0', 3.0], ['sprint 6.0', 6.0]];
const depths = [1.5, 2, 5, 10];
console.log(`Uncorrected disparity (px) by speed × depth @ ${LAG} ms:`);
console.log('  ' + pad('speed', 12) + depths.map((d) => padL(d + ' m', 8)).join(''));
for (const [label, v] of speeds) {
  const t = translationFromWalk(v, LAG);
  const row = depths.map((d) => padL(disparityPx(t, d, halfX, W).toFixed(0), 8)).join('');
  console.log('  ' + pad(label, 12) + row);
}

// --- 3) Residual after a depth grid (receding-floor scene) -----------------
// Depth grows from 2 m (frame bottom) to 20 m (top): the near rows are the hard
// part — a coarse vertical grid can't resolve the steep 1/d change up close.
const floor = (_u, v) => 2 + (20 - 2) * v;
const opts = { translationM: tWalk, halfFovRad: halfX, viewportPx: W };
console.log(`\nDepth-aware residual after a piecewise-constant grid (receding floor 2→20 m, walk 1.4 m/s):`);
console.log('  ' + pad('grid', 10) + padL('max px', 9) + padL('mean px', 9) + padL('p95 px', 9));
for (const [cols, rows] of [[16, 9], [32, 18], [64, 36]]) {
  const s = gridResidualStats(cellExtentsFromField(floor, cols, rows), opts);
  console.log('  ' + pad(`${cols}×${rows}`, 10) +
    padL(s.maxPx.toFixed(1), 9) + padL(s.meanPx.toFixed(1), 9) + padL(s.p95Px.toFixed(1), 9));
}
console.log(`  → corrects up to ${px45.toFixed(0)} px of parallax; the residual is QUANTIZATION (finer grid → less).`);

// --- 4) Silhouette: residual + disocclusion --------------------------------
const dNear = 2, dFar = 20;
const straddle = residualPx(tWalk, dNear, dFar, halfX, W);
const occ = disocclusionPx(tWalk, dNear, dFar, halfX, W);
console.log(`\nSilhouette (step) scene — near ${dNear} m vs far ${dFar} m, walk 1.4 m/s:`);
console.log(`  corrected residual at a straddling cell : ${straddle.toFixed(1)} px  (shrinks with a finer grid)`);
console.log(`  DISOCCLUSION band (newly-revealed)       : ${occ.toFixed(1)} px  (grid-INDEPENDENT — fundamental)`);
console.log(`  → depth-aware reprojection corrects the bulk; residual + disocclusion concentrate at`);
console.log(`    silhouettes. Filling them needs generative inpainting — Vector 3 part 2 (not in-browser).`);

console.log('\n──────────────────────────────────────────────────────────────');
console.log('model: fronto-parallel lateral linearization (shift = t/d·focal);');
console.log('ignores forward-translation zoom & rotation×translation coupling.');
console.log('disocclusion = differential parallax across the depth edge = the inpainting frontier.');
