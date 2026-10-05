/* ---------------------------------------------------------------------------
   raycast.js — Hit detection from a given camera orientation
   ---------------------------------------------------------------------------
   The honest core of the shooter. A "shot" is a ray from the camera position
   along the forward axis of a given (yaw, pitch).

   shooter.js always passes the CURRENT input aim (warp on or off), and before
   calling this rewinds the targets to where the DISPLAYED frame shows them
   (the frame's world time, plus the motion-vector extrapolation when M is on).
   So the ray and the tested targets are the same in both modes; what differs is
   only what the screen centre (the crosshair) shows. Warp ON reprojects the
   image to the current aim, so the crosshair is on the ray. Warp OFF shows the
   frame at its lagged orientation, so the crosshair is off the ray by the
   fresh - rendered angle: a miss while tracking. No faked target states.
--------------------------------------------------------------------------- */

import * as THREE from 'three';

const _raycaster = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Fire a shot and return the nearest target mesh hit, or null.
 * @param origin   camera world position (THREE.Vector3)
 * @param yaw      view yaw (radians)
 * @param pitch    view pitch (radians)
 * @param meshes   array of target meshes to test
 */
export function shoot(origin, yaw, pitch, meshes) {
  // Forward direction for this orientation. Must match how the camera builds
  // its orientation in main.js: Euler(pitch, yaw, 0, 'YXZ') applied to -Z.
  _dir.set(0, 0, -1).applyEuler(_euler.set(pitch, yaw, 0));
  _raycaster.set(origin, _dir);
  const hits = _raycaster.intersectObjects(meshes, false);
  return hits.length ? hits[0].object : null;
}
