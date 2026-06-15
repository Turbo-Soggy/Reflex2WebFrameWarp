/* ---------------------------------------------------------------------------
   parallax-shader.js — Depth-aware reprojection (Vector 3, experimental)
   ---------------------------------------------------------------------------
   A SEPARATE, opt-in variant of the warp fragment shader that adds the parallax
   (translation) term the shipped rotation-only warp omits. It is kept apart from
   the load-bearing warp-shader.js ON PURPOSE — exactly like foveation-shader.js —
   so the working demo is untouched and this can be wired behind a flag when a
   depth buffer is available over the DataChannel.

   The shipped warp:   sampleUV = uGuard + (vUv + uDelta) * uScale
   Depth-aware warp:   sampleUV = uGuard + (vUv + uDelta + uParallax·(uTransUV / depth)) * uScale

   `uDelta`     — rotation reprojection (unchanged, depth-independent).
   `uTransUV`   — CPU-computed camera translation as UV-per-metre-of-depth
                  (= translationUVPerMeter() in replay/parallax.js).
   `depth`      — per-pixel metric depth sampled from a low-res (e.g. 16×9) depth
                  texture streamed from the server; bilinear upsampling smooths it.
   `uParallax`  — 0/1 gate. At 0 this is byte-identical to the rotation-only warp,
                  so enabling it can never silently change the baseline demo.

   HONEST SCOPE: this corrects translation PARALLAX only. It cannot invent the
   pixels a near surface uncovers as the camera moves (disocclusion) — those need
   generative inpainting (Vector 3 part 2), not a resample. The GLSL `parallaxShift`
   below is the exact twin of parallaxDeltaUV() in replay/parallax.js (Node-tested).
--------------------------------------------------------------------------- */

import * as THREE from 'three';

export function createParallaxWarpMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uDelta: { value: new THREE.Vector2(0, 0) },     // rotation reprojection (display-UV)
      uGuard: { value: 0.0 },
      uScale: { value: 1.0 },
      // --- depth-aware parallax inputs ---
      uDepth: { value: null },                        // low-res metric-depth texture
      uTransUV: { value: new THREE.Vector2(0, 0) },   // translationUVPerMeter() (CPU)
      uParallax: { value: 0.0 },                      // 0 = off (identical to warp-shader)
      uMinDepth: { value: 0.2 },                      // clamp so the divide can't blow up
    },

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
      uniform sampler2D uDepth;
      uniform vec2 uDelta;
      uniform vec2 uTransUV;
      uniform float uGuard;
      uniform float uScale;
      uniform float uParallax;
      uniform float uMinDepth;
      varying vec2 vUv;

      void main() {
        // Per-pixel depth (bilinear from the low-res grid), clamped away from 0.
        float depth = max(texture2D(uDepth, vUv).r, uMinDepth);

        // Parallax UV shift = precomputed per-metre numerator / depth. Exact twin
        // of parallaxDeltaUV() in replay/parallax.js. Gated by uParallax.
        vec2 parallaxShift = uParallax * (uTransUV / depth);

        // Same guard-band crop as the shipped warp; rotation + parallax combined.
        vec2 sampleUV = uGuard + (vUv + uDelta + parallaxShift) * uScale;

        gl_FragColor = texture2D(tDiffuse, clamp(sampleUV, 0.0, 1.0));
      }
    `,

    depthTest: false,
    depthWrite: false,
  });
}
