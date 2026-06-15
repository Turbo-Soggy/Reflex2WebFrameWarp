# Vector 2 — Perceptually-Gated Foveated Encoding: Implementation Spec

Status: **geometry locked & validated; one knob (`S_peripheral`) open, pending a
real bitrate measurement.** This document is the synthesis of the architecture +
headless validation in `src/replay/foveation.js`, `bench/foveation-budget.js`,
and `bench/foveation-zone.js`. It specifies *what to build*; it does not claim
numbers that have not been measured. The central map is executable and tested
(`foveatedPhi`, `test/test.js`).

---

## 0. Goal & scope

Cut the guard band's pixel/bit tax (a fixed 12% guard costs **1.73×** the encoded
pixels) by **crushing the resolution of the peripheral margins**, while keeping
the transmitted frame size strictly constant (1280×720) so the encoder's
rate-control never sees a resolution change. Static, macroblock-aligned zones.

**Out of scope here (deferred, honestly):** the crush ratio `S_peripheral` and
the *real* bitrate reduction ΔR — area-squash is only an upper bound (bits ≠
pixels; see the pixel-tag finding), so ΔR needs the WebCodecs harness, not this
spec. Dynamic (velocity-gated) zones — explicitly later, after the static
boundary is proven (a time-varying warp degrades inter-frame prediction).

---

## 1. Principle: foveation is the existing crop's Φ, made piecewise

The deployed reprojection already samples the texture through a map:

```
camSample = uGuard + (vUv + uDelta)·uScale          (warp-shader.js)
```

In centre-relative coordinates (`x_d = vUv − 0.5`, `e_c = encoded − 0.5`) that is
just a **linear Φ of slope `uScale = 0.76`**: `e_c = uScale · x_d`. The displayed
range fills encoded `[−0.38, 0.38]`; the **reserve `[0.38, 0.5]`** (the 0.12
margins) is what the warp pulls from.

Foveation = make that same Φ **piecewise**: a linear **core** out to half-width
`x_b`, then a shallower **periphery** that squashes the margins.

```
Φ(x_d) = sCore·x_d                                  |x_d| ≤ x_b   (core)
         sign(x_d)·[ sCore·x_b + sPeriph·(|x_d|−x_b) ]  |x_d| > x_b   (periphery)
```

(`src/replay/foveation.js: foveatedPhi`; continuous at `x_b` by construction.)

**Set `sCore = uScale = 0.76`.** Two consequences, both load-bearing:
1. The **core is byte-for-byte today's pipeline** — the fovea gets zero new
   compression and zero new artifact.
2. The fovea-safety validation (`crushInnerEccentricityDeg`, which assumes the
   linear core map to locate the crush boundary) is **exactly valid**, because up
   to `x_b` the foveated map *is* that linear map.

So only `sPeriph < 0.76` is a free parameter.

---

## 2. Locked geometry (MB-aligned, validated)

Encoded frame 1280×720 = an **80×45** macroblock grid (16×16 px). Boundaries sit
on MB lines so the encoder never estimates motion across a sub-block resolution
discontinuity. The rectangular core is **taller than wide** because the vertical
FOV (75°) is smaller than the horizontal (107.5°), so the same fractional crush
is fewer degrees of eccentricity vertically (`bench/foveation-zone.js`).

| Parameter | Recommended (margin) | Aggressive (edge) |
|---|---|---|
| Horizontal core | **cols 22–58** (`encoded ±0.225`) | cols 24–56 (`±0.200`) |
| Vertical core | **rows 11–34** (`encoded ±0.256`) | rows 12–33 (`±0.233`) |
| Worst crushed-texel eccentricity (all traces) | **14.9° / 13.4°** | 11.3° / 11.2° |
| Fovea margin (vs ±10.8°) | ~3–4° | ~0.5° (knife-edge) |
| Crush area (geometric **upper bound** on ΔR) | **~77%** | ~81% |

Display core half-width follows from the encoded boundary: `x_b = encoded_half /
sCore`. For the recommended core: `x_b,x = 0.225/0.76 = 0.296`, `x_b,y =
0.256/0.76 = 0.336`.

**Validation result (measured, headless):** across the full trace mix
(calm/brisk pursuit, hot constant-velocity, two wanders, a 40° flick), a crushed
texel never enters the central **±10.8°** for the recommended core. The vertical
axis binds on the strong-pitch trace (`wander-seed2`); horizontal on the hot yaw
traces. **Assumptions, stated:** gaze fixed at view centre (no eye tracker);
fovea radius taken as the central 20% of the horizontal view; trace mix is
representative, not exhaustive.

---

## 3. Server side — the forward map

Per axis, independently (separable; corners get `sPeriph` on both axes — the
extreme periphery, fine). The server renders the wide scene as today, then warps
sampling through Φ⁻¹ before encode so the core keeps full density and the
periphery is squashed into few macroblocks. Transmitted resolution unchanged.

The reserve and warp budget fall out of Φ (§5). The boundary `x_b` and `sPeriph`
ride the metadata channel (§6); for this static design they are constants.

---

## 4. Client side — the sampling composition

This is the existing reprojection with the linear map swapped for Φ. The
reprojection stays a **uniform display-space shift** `uDelta`; foveation is just
applying Φ to the reprojected coordinate — the composition is correct because
both zones are internally linear (constant per-zone Jacobian, no per-pixel
matrix). Per axis:

```glsl
// xb, sCore (=uScale), sPeriph are uniforms (constant for the static design)
float phi(float xd) {
  float a = abs(xd);
  float e = (a <= xb) ? sCore * a : sCore * xb + sPeriph * (a - xb);
  return sign(xd) * e;                       // centre-relative encoded
}

float xs = (vUv.x - 0.5) + clamp(uDelta.x, -uDeltaMax, uDeltaMax);
float ys = (vUv.y - 0.5) + clamp(uDelta.y, -uDeltaMaxY, uDeltaMaxY);
vec2 sampleUV = vec2(phi(xs) + 0.5, phiY(ys) + 0.5);
```

At rest (`uDelta = 0`, inside the core) this reduces to `0.5 + 0.76·x_d` =
today's `camSample` — exact backward compatibility.

**Seam handling (honest):** at `x_b` the slope jumps `sCore → sPeriph`, a
resolution discontinuity. MB-alignment keeps it on a block boundary (clean for
intra-prediction). The 3×3 de-ghost neighbourhood and any bilinear tap that
*straddles* the seam will mix two densities → a thin boundary artifact. Mitigate
with a 1-MB transition ramp or accept it at ≥13° eccentricity; to be checked
visually, not asserted.

---

## 5. Warp headroom & the reserve

Clamp `uDelta` so the leading-edge sample stays inside the frame
(`Φ(0.5 + uDelta) ≤ 0.5`):

```
uDeltaMax = (0.5 − sCore·x_b) / sPeriph − (0.5 − x_b)
```

Sanity: `sPeriph = sCore = 0.76` → `uDeltaMax = 0.158` = today's `uGuard/uScale`.
**Bonus:** because the periphery is shallower, crushing it *increases* the warp
headroom — `sPeriph = 0.38` (2× crush) gives `uDeltaMax ≈ 0.52`, ~3× the motion
the guard can absorb before edge-clamping. Trade: more headroom + fewer bits, at
the cost of low-res periphery when heavily warped (always ≥13° eccentric, §2).

---

## 6. Metadata & trace compatibility

The foveation parameters (`x_b,x`, `x_b,y`, `sPeriph`) are exactly the kind of
out-of-band per-frame data Vector 1's metadata carrier exists for. Static design
⇒ send them once (stream header) or pin them per frame beside the pose. **Input
traces are unaffected** — they are pose-over-time, transport- and
foveation-agnostic; `version: 1` replays unchanged.

---

## 7. Open knobs / required measurements

1. **`S_peripheral` + real ΔR** — the only free parameter. Area-squash says ≤77%
   *pixels* removed; real *bits* saved depends on peripheral detail and must be
   measured (foveated-vs-flat encode at fixed resolution, WebCodecs harness).
2. **Encoder rate-control under warped sampling** — does a fixed warped map
   actually keep RC calm, no keyframe storms? Only the live encoder answers this;
   the headless sim cannot.
3. **Boundary-seam artifact** — magnitude is a visual question (the rig / a JND
   check), not geometry.

---

## 8. What this does NOT model / honest limitations

- **Bits ≠ pixels.** Every bitrate figure here is a geometric upper bound until
  the harness measures it.
- **No eye tracker.** Fovea safety assumes gaze at view centre. A user who
  fixates the frame edge sees the crush at lower eccentricity.
- **Static core is sized for worst-case motion** (hot wander/flick). For the
  demo's actual smooth-pursuit task it is conservative; a demo-only core could
  crush harder (a measured detour, deferred).
- **Inter-frame cost across the seam.** Content panning across the zone boundary
  changes scale frame-to-frame; MB-alignment bounds but does not erase the
  motion-estimation cost there.
- **Dynamic γ(ω) is deliberately excluded** — a time-varying warp fights motion
  compensation; revisit only after the static path is measured.
