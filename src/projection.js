/* ---------------------------------------------------------------------------
   projection.js — Pure projection math (no THREE, no DOM → unit-testable)
   ---------------------------------------------------------------------------
   The guard band renders the scene at a WIDER field of view than is displayed,
   then the warp shader shows only the central `uvScale` crop. For the displayed
   crop to exactly equal the intended display FOV, the wider render FOV must use
   the TANGENT-exact relationship (perspective is linear in tan(angle), not in
   angle):

       tan(renderFovY / 2) = tan(displayFovY / 2) / uvScale

   Kept here as a dependency-free function so it can be tested in isolation
   (see test/test.js).
--------------------------------------------------------------------------- */

/**
 * Wider render FOV (degrees) whose central `uvScale` crop equals `displayFovYDeg`.
 * @param {number} displayFovYDeg  the FOV the user actually sees (degrees)
 * @param {number} uvScale         central crop fraction (1 - 2*guard), 0 < uvScale ≤ 1
 * @returns {number} render FOV in degrees
 */
export function renderFovDeg(displayFovYDeg, uvScale) {
  const rad = (displayFovYDeg * Math.PI) / 180;
  return ((2 * Math.atan(Math.tan(rad / 2) / uvScale)) * 180) / Math.PI;
}
