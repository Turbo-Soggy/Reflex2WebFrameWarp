/* ---------------------------------------------------------------------------
   raycast.js — Hit detection from a given camera orientation
   ---------------------------------------------------------------------------
   The honest core of the shooter. A "shot" is a ray from the camera position
   along the forward axis of a given (yaw, pitch) — i.e. straight through the
   crosshair at screen center.

   What makes the shot hit or miss is WHICH orientation main.js passes in: the
   CURRENT orientation when warp is on (what the reprojected screen shows → you
   hit what you see) or the LAGGED orientation when warp is off (what the stale
   frame shows → you miss while tracking). It's the same real camera-rotation
   latency the warp shader reprojects by — no faked target states.
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
