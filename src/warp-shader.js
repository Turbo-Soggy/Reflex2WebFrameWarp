/* ---------------------------------------------------------------------------
   warp-shader.js — The reprojection fragment shader
   ---------------------------------------------------------------------------
   This is the mathematical core of the whole project, and it's tiny.

   For every pixel on screen we ask: "given that the camera has rotated by some
   small amount since this frame was drawn, where in the OLD frame should this
   pixel's color come from?" The answer is: shift the sampling coordinate by the
   rotation, expressed in texture space.

       warped_uv = vUv + uDelta

   `uDelta` is computed on the CPU (see main.js) as the camera's angular motion
   divided by the field of view — i.e. how far the image should slide, in 0..1
   texture units.

   EDGE IN-PAINTING (Stage 3 — guard band): the scene texture is rendered at a
   WIDER field of view than we display, leaving a margin of real pixels on every
   side (the "guard band"). The displayed image is the central crop:

       sampleUV = uGuard + (vUv + uDelta) * uScale

   where uScale = 1 - 2*uGuard is the fraction of the texture we actually show.
   With no warp (uDelta = 0) this samples exactly the central crop = the normal
   view. When the warp shifts the image, it pulls from the margin — REAL geometry
   instead of stretched border pixels. Only if the motion is large enough to
   exhaust the margin do we fall back to `clamp` (which stretches the edge; we
   prefer it over mirroring because mirroring shows a visible seam on a pan).
--------------------------------------------------------------------------- */

import * as THREE from 'three';

export function createWarpMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },               // the rendered scene texture
      uDelta: { value: new THREE.Vector2(0, 0) }, // reprojection shift, display-UV units
      uGuard: { value: 0.0 },                  // guard-band margin per side (0..0.5)
      uScale: { value: 1.0 },                  // 1 - 2*uGuard (central crop fraction)
    },

    // Full-screen triangle/quad: position already spans clip space [-1,1],
    // so we pass it straight through and just forward the UVs.
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,

    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform vec2 uDelta;
      uniform float uGuard;
      uniform float uScale;
      varying vec2 vUv;

      void main() {
        // Map the displayed pixel into the central crop, then reproject. The
        // reprojection shift is in display-UV units, so scale it into texture
        // space too. Pulling from the guard-band margin = real pixels.
        vec2 sampleUV = uGuard + (vUv + uDelta) * uScale;

        // Fallback in-painting: if the motion exhausts the margin, clamp.
        vec2 uv = clamp(sampleUV, 0.0, 1.0);

        gl_FragColor = texture2D(tDiffuse, uv);
      }
    `,

    depthTest: false,
    depthWrite: false,
  });
}
