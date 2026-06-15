/* ---------------------------------------------------------------------------
   parallax.js — Depth-aware reprojection: the parallax (translation) term
   ---------------------------------------------------------------------------
   Vector 3, part 1 (simulation-level, measured-first — same discipline as the
   foveation vector). The shipped warp corrects camera ROTATION only:

       sampleUV = uGuard + (vUv + uDelta) * uScale          // uDelta = angle / fov

   Rotation parallax is depth-independent, so one global uDelta fixes every
   pixel. Camera TRANSLATION is different: a world point's screen shift is
   inversely proportional to its DEPTH (near things slide more than far things).
   That's the §4.5 parallax error — quantified (~77 px at walking speed, 2 m
   geometry, 150 ms lag) but, in the shipped pipeline, NOT corrected.

   This module is the pure math for correcting it from a low-resolution depth
   buffer, and — just as importantly — for measuring the RESIDUAL that remains:

     • disparity      — the raw, uncorrected parallax (px / UV) at a given depth.
     • residual       — what's left after correcting a depth-quantized CELL with a
                        single representative depth (the 16×9-grid limitation).
     • disocclusion   — the band of newly-revealed pixels at a depth silhouette,
                        which NO single-layer reprojection can fill (that's the
                        inpainting frontier, deliberately out of scope here).

   Model + honest assumptions:
     • Fronto-parallel, small-translation linearization: lateral shift = t/d·focal.
       Ignores the forward (tz) zoom term and rotation×translation coupling — fine
       for the "strafe/walk during lag" regime this quantifies.
     • Pinhole, square pixels: focal_px = (viewportPx/2) / tan(halfFov).
   Pure (no DOM, no THREE) so the browser, the bench and Node tests all import it.
--------------------------------------------------------------------------- */

/** Pinhole focal length in pixels for a half-FOV (radians) and viewport size. */
export function focalPx(halfFovRad, viewportPx) {
  return (viewportPx / 2) / Math.tan(halfFovRad);
}

/** Camera translation (m) covered during a lag window at a given speed (m/s). */
export function translationFromWalk(speedMps, lagMs) {
  return speedMps * (lagMs / 1000);
}

/** Uncorrected lateral parallax in PIXELS for a translation at a single depth. */
export function disparityPx(translationM, depthM, halfFovRad, viewportPx) {
  return (translationM / depthM) * focalPx(halfFovRad, viewportPx);
}

/** Same disparity, expressed as a fraction of the display in UV (0..1) units —
    directly addable to the shader's uDelta. */
export function disparityUV(translationM, depthM, halfFovRad) {
  return (translationM / depthM) / (2 * Math.tan(halfFovRad));
}

/**
 * The shader-facing half of the correction. A camera lateral translation maps to
 * a UV shift of `transUVPerMeter / depth` — so we precompute the depth-independent
 * numerator on the CPU (per frame) and let the GPU divide by each pixel's sampled
 * depth. These two helpers are the exact Node twins of the GLSL in
 * parallax-shader.js. Sign convention: camera +x → image samples from the +u side.
 */
export function translationUVPerMeter(txM, tyM, halfFovXRad, halfFovYRad) {
  return [
    -txM / (2 * Math.tan(halfFovXRad)),
    -tyM / (2 * Math.tan(halfFovYRad)),
  ];
}

/** The per-pixel parallax UV shift: the precomputed numerator over depth. */
export function parallaxDeltaUV(transUVPerMeter, depthM) {
  return [transUVPerMeter[0] / depthM, transUVPerMeter[1] / depthM];
}

/**
 * The single depth that minimises the worst-case disparity error across a cell
 * spanning [dMin, dMax]. Because disparity is linear in INVERSE depth, the best
 * representative is the midpoint in 1/d (the harmonic mean), not the arithmetic
 * mean — correcting in the space the error actually lives in.
 */
export function representativeDepth(dMin, dMax) {
  return 2 / (1 / dMin + 1 / dMax);
}

/**
 * Worst-case residual parallax (PIXELS) left in a cell after correcting it with
 * its optimal single representative depth. This is the error a piecewise-constant
 * depth grid (e.g. 16×9) cannot remove — it shrinks as the grid gets finer or the
 * cell's depth range narrows, and is zero on a constant-depth (flat) cell.
 */
export function residualPx(translationM, dMin, dMax, halfFovRad, viewportPx) {
  const rep = representativeDepth(dMin, dMax);
  const errInvDepth = Math.max(Math.abs(1 / dMin - 1 / rep), Math.abs(1 / dMax - 1 / rep));
  return translationM * errInvDepth * focalPx(halfFovRad, viewportPx);
}

/**
 * The disocclusion band (PIXELS) opened at a depth silhouette between a near and
 * a far surface: the differential parallax across the edge. These are pixels the
 * near surface uncovers as the camera translates — genuinely missing data that
 * depth-aware reprojection CANNOT synthesise (it needs inpainting). Independent
 * of grid resolution: a fundamental limit, not a quantization artefact.
 *
 * Note the clean relationship to residualPx: a cell straddling the full [near,far]
 * step has worst-case residual = disocclusion / 2 (the representative depth sits
 * halfway across the gap in inverse-depth space).
 */
export function disocclusionPx(translationM, dNear, dFar, halfFovRad, viewportPx) {
  return translationM * Math.abs(1 / dNear - 1 / dFar) * focalPx(halfFovRad, viewportPx);
}

/**
 * Residual statistics over a set of depth-grid cells. Each cell is { dMin, dMax }
 * (its depth extent). Returns the max / mean / p95 residual in pixels — the
 * distribution of error a given depth grid leaves behind on a given scene.
 */
export function gridResidualStats(cellExtents, { translationM, halfFovRad, viewportPx }) {
  if (!cellExtents.length) return { maxPx: 0, meanPx: 0, p95Px: 0 };
  const res = cellExtents.map((c) => residualPx(translationM, c.dMin, c.dMax, halfFovRad, viewportPx));
  const sorted = res.slice().sort((a, b) => a - b);
  return {
    maxPx: sorted[sorted.length - 1],
    meanPx: res.reduce((a, b) => a + b, 0) / res.length,
    p95Px: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
  };
}

/**
 * Partition a depth field into a cols×rows grid and return each cell's depth
 * extent { dMin, dMax }, found by sub-sampling. `depthOf(u, v)` returns metric
 * depth for a UV position in [0,1]². Pure; the bench supplies the scene.
 */
export function cellExtentsFromField(depthOf, cols, rows, sub = 4) {
  const cells = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let dMin = Infinity, dMax = -Infinity;
      for (let sy = 0; sy <= sub; sy++) {
        for (let sx = 0; sx <= sub; sx++) {
          const u = (cx + sx / sub) / cols;
          const v = (cy + sy / sub) / rows;
          const d = depthOf(u, v);
          if (d < dMin) dMin = d;
          if (d > dMax) dMax = d;
        }
      }
      cells.push({ dMin, dMax });
    }
  }
  return cells;
}
