/* ---------------------------------------------------------------------------
   foveation.js — Vector 2 budget geometry: where does the warp pull margin from?
   ---------------------------------------------------------------------------
   Vector 2 wants to foveally CRUSH the guard-band margins of the encoded frame.
   The objection (raised honestly before building anything): in THIS system the
   guard band is not true periphery — it is the warp RESERVE, and the warp
   slides margin texels toward the view centre as the camera rotates. If we
   crush the margins, do crushed pixels ever reach the FOVEA?

   This module answers it with geometry, not assertion. The reprojection samples
   the texture at  camSample = uGuard + (vUv + du)·uScale  (warp-shader.js). A
   displayed pixel at display-UV vUv is sourced from the right-hand margin
   (texture > 1−uGuard) exactly when vUv > 1 − du, i.e. the fraction of the
   viewport drawn from the margin is |du|. The shift |du| is capped at
   maxShiftUV = g/uScale (beyond that the shader edge-clamps — it cannot pull in
   MORE margin), and pipeline-sim reports how much of that cap each tick used as
   `guardUsed`. So:

       marginViewportFraction = min(guardUsed, 1) · g/uScale

   and the margin strip occupies the OUTER `marginViewportFraction` of the view
   on the leading side — its inner edge sits at eccentricity
   (0.5 − marginViewportFraction)·FOV from centre. High eccentricity ⇒ the
   margin only ever surfaces in the far periphery, where acuity is already low,
   ⇒ foveation is safe. Low eccentricity ⇒ it reaches the fovea ⇒ it isn't.

   Pure geometry (no DOM, no THREE) → unit-testable in Node.
--------------------------------------------------------------------------- */

import { displayFovX, DEFAULT_CONFIG } from './pipeline-sim.js';

const RAD = Math.PI / 180;

/**
 * Fraction of the displayed viewport width sourced from the guard margin when
 * the warp has consumed `guardUsed` of it. Clamped at 1: once the margin is
 * exhausted the shader edge-clamps, so it can never pull in MORE than the
 * margin's worth (maxShiftUV = g/uScale).
 */
export function marginViewportFraction(guardUsed, guard) {
  const uScale = 1 - 2 * guard;
  const maxShiftUV = guard / uScale;
  return Math.min(Math.max(guardUsed, 0), 1) * maxShiftUV;
}

/**
 * Eccentricity (degrees from view centre) of the INNER edge of that margin
 * strip — everything more peripheral than this is (transiently) margin-sourced.
 * The fovea is safe iff this stays larger than the foveal radius in degrees.
 */
export function marginInnerEccentricityDeg(guardUsed, guard, config = DEFAULT_CONFIG) {
  const frac = marginViewportFraction(guardUsed, guard);
  const fovXDeg = displayFovX({ ...DEFAULT_CONFIG, ...config }) / RAD;
  return Math.max(0, 0.5 - frac) * fovXDeg; // |u−0.5|·FOV, with u = 1−frac
}

/**
 * Smallest display eccentricity (deg, one axis) at which a CRUSHED (peripheral)
 * texel is sampled, for a STATIC inner core of encoded half-width `coreHalf`
 * (core = encoded [0.5−coreHalf, 0.5+coreHalf]). This treats Φ as the existing
 * linear guard crop with the core/crush partition overlaid — i.e. it SUBSUMES
 * the guard band. `du` is the warp's applied display-UV shift (signed). Returns
 * Infinity if the crush zone is off-screen this tick, 0 if it reaches centre.
 *
 * Geometry: a display pixel vUv samples encoded e = guard + (vUv+du)·uScale, so
 * the core boundary at encoded 0.5±coreHalf sits at vUv = (e−guard)/uScale − du.
 */
export function crushInnerEccentricityDeg(coreHalf, guard, du, fovDeg) {
  const uScale = 1 - 2 * guard;
  const vAt = (e) => (e - guard) / uScale - du;
  const vR = vAt(0.5 + coreHalf); // vUv > vR is right-crushed
  const vL = vAt(0.5 - coreHalf); // vUv < vL is left-crushed
  const right = vR >= 1 ? Infinity : vR < 0.5 ? 0 : (vR - 0.5) * fovDeg;
  const left = vL <= 0 ? Infinity : vL > 0.5 ? 0 : (0.5 - vL) * fovDeg;
  return Math.min(right, left);
}

/**
 * The foveated map Φ (one axis), the spec's central formula made executable.
 * Maps a centre-relative DISPLAY coordinate `xd` ∈ [−0.5, 0.5] (already
 * reprojected, i.e. vUv−0.5+uDelta) to a centre-relative ENCODED coordinate:
 * a linear CORE of slope `sCore` out to half-width `xb`, then a shallower
 * linear PERIPHERY of slope `sPeriph < sCore` that crushes the margins.
 *
 * Setting sCore = uScale (0.76) makes the core IDENTICAL to the deployed linear
 * crop — the fovea is byte-for-byte today's pipeline, and the crushInner…()
 * fovea-safety result (which assumes that linear core) stays exactly valid.
 * The encoded UV is this + 0.5. Continuous at xb by construction.
 */
export function foveatedPhi(xd, { xb, sCore, sPeriph }) {
  const a = Math.abs(xd);
  const e = a <= xb ? sCore * a : sCore * xb + sPeriph * (a - xb);
  return Math.sign(xd) * e;
}

/**
 * Inverse of foveatedPhi: centre-relative ENCODED → centre-relative DISPLAY.
 * The server squash needs this direction (encoded pixel ← wide-render sample);
 * the client reconstruction needs foveatedPhi. The GLSL twins in
 * foveation-shader.js mirror both, verified against these by the round-trip test.
 */
export function foveatedPhiInverse(ec, { xb, sCore, sPeriph }) {
  const eb = sCore * xb;
  const a = Math.abs(ec);
  const x = a <= eb ? a / sCore : xb + (a - eb) / sPeriph;
  return Math.sign(ec) * x;
}

/**
 * Core slope that makes Φ(XR) = 0.5 for a given periphery slope and render
 * extent XR (centre-relative display). This is the REAL cloud-pipeline config:
 * keep the existing render (cap XR at the guard extent 0.5 + g/uScale) and
 * SUPERSAMPLE the core instead of widening the FOV. sCore > uScale, growing as
 * sPeriph shrinks. (Derivation in the INTEGRATION CONSTRAINT note.)
 */
export function sCoreForExtent(xb, sPeriph, XR) {
  return (0.5 - sPeriph * (XR - xb)) / xb;
}

// The locked fovea-safe rectangular core (MB-aligned), from bench/foveation-zone.js.
// Encoded grid is 80×45 macroblocks (1280×720 / 16); `cols`/`rows` are the central
// core's MB bounds, everything outside is the crush zone. Single-sourced so the ΔR
// harness and the eventual shader can't drift from the validated geometry.
export const CORE = { mbCols: 80, mbRows: 45, cols: [22, 58], rows: [11, 34] };

/** The core rectangle in encoded pixels (default 16 px macroblocks). */
export function coreRectPx(mb = 16) {
  return {
    x0: CORE.cols[0] * mb, y0: CORE.rows[0] * mb,
    x1: CORE.cols[1] * mb, y1: CORE.rows[1] * mb,
  };
}
