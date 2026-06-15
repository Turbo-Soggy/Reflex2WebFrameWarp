/* ---------------------------------------------------------------------------
   config.js — single source of truth for the shared pipeline constants
   ---------------------------------------------------------------------------
   DISPLAY_FOV_Y and the guard band were duplicated across main.js, the cloud
   server/client, and the headless sim — change one and the others silently
   diverge. They live here once. Pure (no DOM, no THREE), so every layer
   (browser and Node) can import it.
--------------------------------------------------------------------------- */

export const DISPLAY_FOV_Y = 75;          // vertical FOV the user sees, degrees
export const ASPECT = 16 / 9;             // capture aspect (1280×720)
export const GUARD = 0.12;                // guard-band margin per side (texture-relative)
export const UV_SCALE = 1 - 2 * GUARD;    // central crop fraction the warp displays (0.76)

/** Horizontal FOV (radians) from a vertical FOV (degrees) and an aspect ratio. */
export function fovXRad(fovYDeg = DISPLAY_FOV_Y, aspect = ASPECT) {
  return 2 * Math.atan(Math.tan((fovYDeg * Math.PI / 180) / 2) * aspect);
}
