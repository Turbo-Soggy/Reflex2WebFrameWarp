/* ---------------------------------------------------------------------------
   velocity-pass.js — Renders the screen-space velocity buffer
   ---------------------------------------------------------------------------
   A second 30 FPS pass that writes, per pixel, the screen-space velocity of
   whatever object covers it — encoded into the R and G channels, centred at
   0.5 (so 0.5,0.5 = no motion). The warp shader later reads this to displace
   moving objects correctly, instead of smearing/juddering them.

   WHY a separate buffer (vs. just camera reprojection): the camera warp shifts
   the WHOLE frame by one global delta. That can't account for an object moving
   independently of the camera. The velocity buffer carries each object's own
   motion, so the warp can apply a different delta per pixel. This is the same
   idea motion-vector reprojection (e.g. DLSS Frame Generation) is built on.

   SIMPLIFIED implementation (per the spec's staged plan): the only moving
   objects are flat, fast bullseye targets, so we compute each target's velocity
   on the CPU using the real view-projection (project the centre and a slightly-
   advanced centre, take the screen difference per second) and fill its disc with
   that constant velocity. Static geometry is left at the cleared zero value, so
   it contributes no motion. (A full per-pixel previous-MVP pass would generalise
   to arbitrary deforming/rotating geometry — future refinement.)
--------------------------------------------------------------------------- */

import * as THREE from 'three';

const _now = new THREE.Vector3();
const _next = new THREE.Vector3();

export class VelocityPass {
  constructor() {
    // Flat material: outputs one constant velocity (set per target) across the
    // whole disc, as RAW UV/sec into a float buffer. No lighting, no depth write
    // (our target is never occluded).
    this.material = new THREE.ShaderMaterial({
      uniforms: { uVel: { value: new THREE.Vector2(0, 0) } },
      vertexShader: /* glsl */ `
        void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec2 uVel;            // screen velocity in UV/sec (raw, signed)
        void main() { gl_FragColor = vec4(uVel, 0.0, 1.0); }
      `,
      depthTest: false,
      depthWrite: false,
    });
  }

  /**
   * Render the velocity buffer.
   * @param renderer   shared WebGLRenderer
   * @param rt         the velocity render target
   * @param camera     the render camera (already at the lagged orientation)
   * @param meshes     target meshes
   * @param velocities world-space velocity (THREE.Vector3) per mesh, aligned
   */
  render(renderer, rt, camera, meshes, velocities) {
    camera.updateMatrixWorld();
    renderer.setRenderTarget(rt);
    renderer.setScissorTest(false);
    // Clear to zero → "no motion" everywhere (static geometry).
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.clear();

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      this.material.uniforms.uVel.value.copy(screenVelocity(mesh.position, velocities[i], camera));
      const original = mesh.material;
      mesh.material = this.material;
      renderer.render(mesh, camera);
      mesh.material = original;
    }

    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.setRenderTarget(null);
  }
}

/**
 * Screen-space velocity of a point (UV per second), via the real view-projection.
 * Project the point and a version advanced one step along its world velocity,
 * then take the UV difference per second. This is the "simplified but correct"
 * projection — it uses the actual camera matrices, not a hand approximation.
 */
const _out = new THREE.Vector2();
function screenVelocity(center, worldVel, camera) {
  const h = 0.05; // seconds
  _now.copy(center).project(camera);                       // NDC [-1,1]
  _next.copy(center).addScaledVector(worldVel, h).project(camera);
  // NDC→UV scale is 0.5; divide by h for per-second. Raw, signed.
  _out.set(
    (_next.x - _now.x) * 0.5 / h,
    (_next.y - _now.y) * 0.5 / h
  );
  return _out;
}
