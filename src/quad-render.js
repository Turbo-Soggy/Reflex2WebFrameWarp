/* ---------------------------------------------------------------------------
   quad-render.js — Draws a textured full-screen quad through the warp shader
   ---------------------------------------------------------------------------
   A tiny scene containing a single rectangle that covers the screen. We point
   the warp material at the rendered-scene texture, set the reprojection delta
   (0 when warp is off, the fresh camera motion when on), and draw it to the
   fullscreen viewport.
--------------------------------------------------------------------------- */

import * as THREE from 'three';
import { createWarpMaterial } from './warp-shader.js';

export class QuadRenderer {
  constructor() {
    this.scene = new THREE.Scene();
    // Camera is irrelevant (the vertex shader ignores it) but render() needs one.
    this.camera = new THREE.Camera();
    this.material = createWarpMaterial();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** Configure the guard-band margin (fraction per side). Set once at startup. */
  setGuard(guard) {
    this.material.uniforms.uGuard.value = guard;
    this.material.uniforms.uScale.value = 1 - 2 * guard;
  }

  /**
   * Draw the texture to the fullscreen viewport, warped by `delta`.
   * @param renderer  the shared WebGLRenderer
   * @param texture   the rendered-scene color texture (from WarpTarget)
   * @param delta     [du, dv] camera reprojection shift in display-UV units
   * @param width     viewport width, in CSS pixels
   * @param height    viewport height, in CSS pixels
   * @param mv        { texture, dtSeconds, enabled } motion-vector inputs
   */
  render(renderer, texture, delta, width, height, mv) {
    const u = this.material.uniforms;
    u.tDiffuse.value = texture;
    u.uDelta.value.set(delta[0], delta[1]);
    u.uVelocityBuffer.value = mv.texture;
    u.uDeltaTime.value = mv.dtSeconds;
    u.uMotionVectors.value = mv.enabled ? 1 : 0;

    renderer.setViewport(0, 0, width, height);
    renderer.setScissorTest(false);
    renderer.render(this.scene, this.camera);
  }
}
