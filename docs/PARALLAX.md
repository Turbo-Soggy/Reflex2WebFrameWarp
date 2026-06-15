# Depth-Aware Reprojection — the parallax term (Vector 3, part 1)

The shipped warp corrects camera **rotation** only. This note adds the
**translation (parallax)** term at simulation level — quantified, corrected, and
measured for residual — following the project's measure-first discipline. The
unsolved remainder (disocclusion) is stated honestly as the inpainting frontier.

## 1. Why rotation-only leaves an error

The reprojection shifts every pixel by one global vector:

```
sampleUV = uGuard + (vUv + uDelta) * uScale      uDelta = angle / fov
```

That is exact for pure rotation, because a rotation moves every pixel by the same
angle **regardless of depth**. Camera **translation** does not: a world point's
screen shift is inversely proportional to its depth — near things slide more than
far things. One global `uDelta` therefore cannot fix it.

### The §4.5 figure, reproduced

Lateral parallax in pixels, fronto-parallel pinhole:

```
disparity_px = (t / d) · focal      focal = (viewport/2) / tan(halfFovX)
```

At walking speed (1.4 m/s), 150 ms lag → t = 0.21 m, depth d = 2 m, 1920-wide,
107.5° horizontal FOV → **≈ 74 px** (the paper's "~77 px"; `node bench/parallax.js`).
It scales straight off depth: ~30 px at 5 m, ~15 px at 10 m; and off speed: a
sprint at 2 m is **~317 px**.

## 2. The correction (depth-aware reprojection)

Stream a low-resolution **depth grid** (e.g. 16×9) server→client over the
DataChannel and add a per-pixel parallax shift to `uDelta`:

```
sampleUV = uGuard + (vUv + uDelta + uParallax · (uTransUV / depth)) * uScale
```

- `uTransUV` — camera translation as UV-per-metre-of-depth, computed once per
  frame on the CPU (`translationUVPerMeter`, `src/replay/parallax.js`).
- `depth` — sampled (bilinear) from the depth texture.
- `uParallax` — a 0/1 gate; at 0 it is byte-identical to the shipped warp.

Implemented as the opt-in `src/parallax-shader.js`, kept **separate** from the
load-bearing `warp-shader.js` (demo-safe), with the GLSL as the exact twin of the
Node-tested `parallaxDeltaUV`.

## 3. What it buys — and the residual (measured)

`bench/parallax.js`, receding floor 2→20 m, walk 1.4 m/s @ 150 ms:

| depth grid | max px | mean px |
|---|---|---|
| 16×9  | 18.5 | 3.7 |
| 32×18 | 12.3 | 1.8 |
| 64×36 |  7.4 | 0.9 |

The residual is a **quantization** error (piecewise-constant depth per cell): it
shrinks as the grid gets finer, against the ~74 px it corrects. Correcting a cell
with its optimal single depth uses the **inverse-depth midpoint** (the harmonic
mean), since disparity is linear in 1/d.

## 4. The honest limit — disocclusion (future work)

At a depth **silhouette** (near 2 m vs far 20 m), the camera uncovers a band of
**newly-revealed** pixels — a **~66 px disocclusion gap**, *independent of grid
resolution*. No single-layer resample can fill it; it is genuinely missing data.
That is **Vector 3 part 2**: a lightweight generative inpainting model with a
sub-millisecond WebGPU inference budget — **not achievable in a browser today**,
so it remains a design target, not an implementation.

Neat relationship the bench confirms: a cell straddling the full step has
best-case residual = **disocclusion / 2** (the representative depth sits mid-gap).

## 5. Model assumptions (state in the paper)

- Fronto-parallel **lateral** linearization, `shift = t/d·focal`.
- Ignores the forward-translation **zoom** term and **rotation×translation**
  coupling — fine for the strafe/walk-during-lag regime this quantifies.
- Pinhole, square pixels.

All numbers are pure arithmetic (`src/replay/parallax.js`), unit-tested in
`test/test.js` and reproducible via `node bench/parallax.js`. Simulation-level,
like the foveation vector — hardware-true MtP still depends on Vector 4.
