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

   MOTION VECTORS (motion-vectors branch): alongside the color buffer we keep a
   second, matching render target — the VELOCITY buffer. It is rendered at the
   same 30 FPS, at the same resolution, from the same camera, but stores each
   pixel's screen-space object velocity (RG, centred at 0.5) instead of colour.
   The warp shader reads both: colour to sample, velocity to displace moving
   objects per-pixel. Static geometry has zero velocity, so it is unaffected.
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

    // Velocity buffer: same size, but DATA — a HALF-FLOAT target storing raw
    // signed screen velocity (UV/sec), 0 = no motion. Float avoids 8-bit
    // precision loss and the sRGB clear-colour conversion that would corrupt a
    // 0.5-centred encoding. Nearest filtering so velocities don't bleed across
    // object edges.
    this.velocityRT = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      depthBuffer: false, // the velocity material doesn't depth-test (target unoccluded)
    });

    // Orientation the most recent frame was rendered with (radians).
    this.renderedYaw = 0;
    this.renderedPitch = 0;
  }

  setSize(width, height) {
    const w = Math.max(1, width), h = Math.max(1, height);
    this.rt.setSize(w, h);
    this.velocityRT.setSize(w, h);
  }

  get texture() {
    return this.rt.texture;
  }

  get velocityTexture() {
    return this.velocityRT.texture;
  }
}
