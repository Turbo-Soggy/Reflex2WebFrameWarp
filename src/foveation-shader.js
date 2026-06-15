/* ---------------------------------------------------------------------------
   foveation-shader.js — Vector 2: the foveated map Φ in GLSL (docs/FOVEATION.md)
   ---------------------------------------------------------------------------
   Two materials implement the two ends of the Pose-Tagged foveated pipeline:

     • SQUASH (server): build the encoded frame by sampling the wide render at
       Φ⁻¹ — the core keeps full density, the periphery is squashed into the
       margins. (foveatedPhiInverse.)
     • DISPLAY (client): reconstruct the view by sampling the encoded frame at
       Φ(vUv + uDelta) — the §4 composition. The reprojection stays a uniform
       display-space shift; foveation is just applying Φ to the shifted coord,
       which works because each zone is internally linear (constant Jacobian).

   The GLSL `phi` / `phiInv` below are exact twins of foveatedPhi /
   foveatedPhiInverse (src/replay/foveation.js), which are Node round-trip
   tested — so the shader math is verified even though WebGL isn't run here.

   Separable per axis (rectangular core): `uXb` carries the display core
   half-width for x and y; `uSCore = uScale = 0.76` (core = today's pipeline),
   `uSPeriph = 0.38` (the ΔR-measured knob). `uXR` is the encoded frame's
   display-direction half-extent per axis (= Φ⁻¹(0.5)).
--------------------------------------------------------------------------- */

import * as THREE from 'three';

// GLSL twins of foveatedPhi / foveatedPhiInverse — keep in lockstep with the JS.
const PHI_GLSL = /* glsl */ `
  float phi(float x, float xb, float sC, float sP) {
    float a = abs(x);
    float e = a <= xb ? sC * a : sC * xb + sP * (a - xb);
    return sign(x) * e;
  }
  float phiInv(float e, float xb, float sC, float sP) {
    float eb = sC * xb;
    float a = abs(e);
    float x = a <= eb ? a / sC : xb + (a - eb) / sP;
    return sign(e) * x;
  }
`;

// Fullscreen quad: position already spans clip space, forward the UVs.
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function sharedUniforms() {
  return {
    uXb: { value: new THREE.Vector2(0.296, 0.336) }, // display core half (x,y) = encodedHalf / sCore
    uSCore: { value: 0.76 },
    uSPeriph: { value: 0.38 },
    uXR: { value: new THREE.Vector2(1.02, 0.98) },    // Φ⁻¹(0.5) per axis (set from JS)
  };
}

/** SERVER squash: encoded pixel ← wide-render sample at Φ⁻¹ (periphery squashed). */
export function createSquashMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { tInput: { value: null }, ...sharedUniforms() },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tInput;
      uniform vec2 uXb, uXR;
      uniform float uSCore, uSPeriph;
      ${PHI_GLSL}
      void main() {
        vec2 ec = vUv - 0.5;                       // centre-relative encoded
        float xd = phiInv(ec.x, uXb.x, uSCore, uSPeriph);
        float yd = phiInv(ec.y, uXb.y, uSCore, uSPeriph);
        vec2 tuv = vec2(xd / (2.0 * uXR.x), yd / (2.0 * uXR.y)) + 0.5; // wide-render UV
        gl_FragColor = texture2D(tInput, tuv);
      }
    `,
    depthTest: false, depthWrite: false,
  });
}

/**
 * CLIENT display: reconstruct the warped view from the encoded frame.
 *   uMode 0 = reconstructed (Φ(vUv+uDelta) — the real path),
 *   uMode 1 = the encoded frame shown directly (see the squash),
 *   uMode 2 = the full-res wide render at the SAME view (A/B against 0).
 */
export function createDisplayMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      tEncoded: { value: null }, tInput: { value: null },
      uDelta: { value: new THREE.Vector2(0, 0) },
      uMode: { value: 0 },
      ...sharedUniforms(),
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tEncoded, tInput;
      uniform vec2 uXb, uXR, uDelta;
      uniform float uSCore, uSPeriph, uMode;
      ${PHI_GLSL}
      void main() {
        if (uMode < 0.5) {                          // reconstructed: Φ composition + warp
          vec2 xs = (vUv - 0.5) + uDelta;
          float ex = phi(xs.x, uXb.x, uSCore, uSPeriph);
          float ey = phi(xs.y, uXb.y, uSCore, uSPeriph);
          gl_FragColor = texture2D(tEncoded, vec2(ex, ey) + 0.5);
        } else if (uMode < 1.5) {                   // encoded frame, raw
          gl_FragColor = texture2D(tEncoded, vUv);
        } else {                                    // full-res, same view (A/B)
          vec2 xs = (vUv - 0.5) + uDelta;
          vec2 tuv = vec2(xs.x / (2.0 * uXR.x), xs.y / (2.0 * uXR.y)) + 0.5;
          gl_FragColor = texture2D(tInput, tuv);
        }
      }
    `,
    depthTest: false, depthWrite: false,
  });
}
