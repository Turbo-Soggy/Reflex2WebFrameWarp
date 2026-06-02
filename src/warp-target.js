/* ---------------------------------------------------------------------------
   warp-target.js — Off-screen render target ("render to texture")
   ---------------------------------------------------------------------------
   Instead of drawing the 3D scene straight to the screen, Stage 2 draws it
   into an off-screen image (a WebGLRenderTarget). That image is then sampled
   by the warp shader and stretched onto the screen.

   Why bother? Because once the scene is "frozen" into a texture, we can cheaply
   reproject it every display refresh — shifting it to follow the freshest mouse
   input — WITHOUT re-rendering the expensive 3D scene. That's the entire trick.

   We also remember the camera orientation the frame was rendered AT, so the
   compositor can later compute how far the camera has moved since, and warp by
   exactly that much.
--------------------------------------------------------------------------- */

import * as THREE from 'three';

export class WarpTarget {
  constructor(width, height) {
    this.rt = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true, // the 3D scene needs a depth buffer to sort correctly
    });
    // The RT holds tone-mapped, sRGB-encoded color so we can sample & display
    // it directly without a second color conversion.
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;

    // Orientation the most recent frame was rendered with (radians).
    this.renderedYaw = 0;
    this.renderedPitch = 0;
  }

  setSize(width, height) {
    this.rt.setSize(Math.max(1, width), Math.max(1, height));
  }

  get texture() {
    return this.rt.texture;
  }
}
