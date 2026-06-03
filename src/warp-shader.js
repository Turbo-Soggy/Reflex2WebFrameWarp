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
      uDelta: { value: new THREE.Vector2(0, 0) }, // camera reprojection shift, display-UV units
      uGuard: { value: 0.0 },                  // guard-band margin per side (0..0.5)
      uScale: { value: 1.0 },                  // 1 - 2*uGuard (central crop fraction)
      // --- motion-vector inputs ---
      uVelocityBuffer: { value: null },        // RG screen-velocity (UV/sec), raw signed, 0 = none
      uDeltaTime: { value: 0.0 },              // seconds since the source frame was rendered
      uMotionVectors: { value: 0.0 },          // 0 = off, 1 = on
      uTexelSize: { value: new THREE.Vector2(1 / 1024, 1 / 1024) }, // 1 / scene-texture size
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
      uniform sampler2D uVelocityBuffer;
      uniform vec2 uDelta;
      uniform float uGuard;
      uniform float uScale;
      uniform float uDeltaTime;
      uniform float uMotionVectors;
      uniform vec2 uTexelSize;
      varying vec2 vUv;

      // Trust motion vectors only up to a small displacement (~12px @ 1080p).
      // Beyond this — high lag / low FPS — extrapolation overshoots and tears, so
      // we cap the velocity contribution. (The camera term below is NOT clamped.)
      const float MAX_VEL_CONTRIBUTION = 0.015; // UV

      void main() {
        // 1) Map the displayed pixel into the central crop (texture space), then
        //    apply the global CAMERA reprojection (display-UV → texture via uScale).
        //    This camera term is unclamped (guard-band handles the edges).
        vec2 camSample = uGuard + (vUv + uDelta) * uScale;

        // 2) Per-pixel OBJECT motion: read this pixel's screen velocity (raw
        //    UV/sec; static pixels read 0 → no change), extrapolate by the frame's
        //    age, then CLAMP the contribution. Sampling backward by the motion
        //    makes the moving object appear at its current position.
        vec2 vel = texture2D(uVelocityBuffer, clamp(camSample, 0.0, 1.0)).rg;
        vec2 velContribution = clamp(vel * uDeltaTime, -MAX_VEL_CONTRIBUTION, MAX_VEL_CONTRIBUTION);
        vec2 objShift = uMotionVectors * velContribution;

        vec2 sampleUV = clamp(camSample - objShift, 0.0, 1.0);
        vec4 warpedColor = texture2D(tDiffuse, sampleUV);

        // 3) DE-GHOSTING (neighborhood color clamping). Constrain the reprojected
        //    color to the min/max AABB of the 3x3 neighborhood at the CURRENT
        //    (un-object-shifted) location, camSample. This removes the bright halo
        //    where motion-vector warp drags a moving object's color into its
        //    neighbours. On static / warp-off pixels objShift = 0, so warpedColor
        //    IS the neighborhood centre and is already within range → a no-op.
        //    Same neighborhood-clamp idea used by UE5 TAA and DLSS history rejection.
        vec4 minColor = vec4(1.0);
        vec4 maxColor = vec4(0.0);
        for (int x = -1; x <= 1; x++) {
          for (int y = -1; y <= 1; y++) {
            vec2 offset = vec2(float(x), float(y)) * uTexelSize;
            vec4 neighbor = texture2D(tDiffuse, clamp(camSample + offset, 0.0, 1.0));
            minColor = min(minColor, neighbor);
            maxColor = max(maxColor, neighbor);
          }
        }

        gl_FragColor = clamp(warpedColor, minColor, maxColor);
      }
    `,

    depthTest: false,
    depthWrite: false,
  });
}
