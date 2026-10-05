/* ---------------------------------------------------------------------------
   quad-render.js — Draws a textured full-screen quad through the warp shader
   ---------------------------------------------------------------------------
   A tiny scene containing a single rectangle that covers the screen. We point
   the warp material at the rendered-scene texture, set the reprojection delta
   (0 when warp is off, the fresh camera motion when on), and draw it to the
   fullscreen viewport.

   PHASE 2 (mechanism views): render() optionally takes a viewport rect so the
   same texture can be drawn more than once per display frame (side-by-side).
   Viewport AND scissor are set to the same rect with the scissor test on, so
   the renderer's autoClear only wipes that rect instead of the whole canvas.
   The caller does one full clear per frame before the per-view draws. A second
   QuadRenderer left at guard 0 draws the WHOLE wide-FOV texture (x-ray view).
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

  /** Guard-band zone tint (Z key): cyan = sampled from the margin, red = clamped. */
  setShowZones(on) {
    this.material.uniforms.uShowZones.value = on ? 1 : 0;
  }

  /** Display gain for projectors (presenter mode); 1 = exact pass-through. */
  setExposure(v) {
    this.material.uniforms.uExposure.value = v;
  }

  /** Texel size of the scene texture (1/width, 1/height) for the de-ghost pass. */
  setTexelSize(width, height) {
    this.material.uniforms.uTexelSize.value.set(1 / width, 1 / height);
  }

  /**
   * Draw the texture to the fullscreen viewport, warped by `delta`.
   * @param renderer  the shared WebGLRenderer
   * @param texture   the rendered-scene color texture (from WarpTarget)
   * @param delta     [du, dv] camera reprojection shift in display-UV units
   * @param width     viewport width, in CSS pixels
   * @param height    viewport height, in CSS pixels
   * @param mv        { texture, dtSeconds, enabled } motion-vector inputs
   * @param rect      optional {x, y, w, h} sub-viewport in CSS px, bottom-left
   *                  origin (WebGL convention). Omitted → fullscreen, exactly as
   *                  before (scissor test off).
   */
  render(renderer, texture, delta, width, height, mv, rect) {
    const u = this.material.uniforms;
    u.tDiffuse.value = texture;
    u.uDelta.value.set(delta[0], delta[1]);
    u.uVelocityBuffer.value = mv.texture;
    u.uDeltaTime.value = mv.dtSeconds;
    u.uMotionVectors.value = mv.enabled ? 1 : 0;

    if (rect) {
      // Same rect for viewport and scissor: the viewport maps the quad into the
      // rect, the scissor confines autoClear's clear to it (without it the
      // second draw of a frame would wipe the first).
      renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
      renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
      renderer.setScissorTest(true);
      renderer.render(this.scene, this.camera);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, width, height);
    } else {
      renderer.setViewport(0, 0, width, height);
      renderer.setScissorTest(false);
      renderer.render(this.scene, this.camera);
    }
  }
}
