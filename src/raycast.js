/* ---------------------------------------------------------------------------
   raycast.js — Hit detection from a given camera orientation
   ---------------------------------------------------------------------------
   The honest core of the shooter. A "shot" is a ray from the camera position
   along the forward axis of a given (yaw, pitch) — i.e. straight through the
   crosshair at screen center.

   The trick that makes left miss and right hit on the SAME click is WHICH
   orientation we pass in:

     • LEFT shot  → the LAGGED orientation (what the un-warped left image shows).
     • RIGHT shot → the CURRENT orientation when warp is on (what the warped
                    image shows), or the lagged one when warp is off.

   Both shots are tested against the SAME target meshes. So the only thing that
   can make them disagree is the camera-rotation latency between the lagged and
   current view — which is exactly the quantity the warp shader reprojects by.
   No faked target states; the divergence emerges from the real warp mechanism.
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
