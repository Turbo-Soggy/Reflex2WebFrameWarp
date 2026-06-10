# Option C results: the velocity-adaptive guard band

> Phase 3 of the research roadmap (option C — "smallest, cleanest"; scoped
> honestly as a strong *section*, not a paper spine). Policy in
> `src/replay/adaptive-guard.js`; evaluation: `node bench/adaptive.js`;
> properties locked in `test/test.js`. Everything below is reproducible
> bit-for-bit from those two commands.

## The policy in one line

Per rendered frame, size the guard band so it absorbs the **worst angular
speed observed in the last 500 ms**, times a 1.2 safety factor, over the
frame's worst-case displayed age `A = L + T_r + T_d` — using the inverted
margin equation from THEORY.md §3: `g = s/(F + 2s)`, `s = ω̂·A·safety`,
clipped to `[0.02, 0.20]`.

## Results (lag 80 ms, 30 FPS render, 60 Hz display; 10 s per trace)

`pixel_cost` is rendered pixels relative to rendering exactly what is shown
(fixed 12% guard = 1.73, i.e. +73%). `clamp` is the fraction of display ticks
where the margin ran out (visible edge artifacts); `resid p95` the resulting
view-direction error.

| Trace | Policy | pixel cost | clamp rate | resid p95 (deg) |
|---|---|---|---|---|
| calm sine (peak 13°/s) | fixed 0.12 | 1.73 | 0 | 0 |
| | **adaptive** | **1.09** | **0** | **0** |
| brisk sine (peak 94°/s) | fixed 0.12 | 1.73 | 0 | 0 |
| | **adaptive** | **1.69** | **0** | **0** |
| constant 150°/s | fixed 0.12 | 1.73 | 0.005 | 0 (max 1.02) |
| | **adaptive** | **2.32** | **0** | **0** |
| wander seed 1 | fixed 0.12 | 1.73 | 0.007 | 0 (max 1.02) |
| | **adaptive** | **1.92** | **0** | **0** |
| wander seed 2 (hot) | fixed 0.12 | 1.73 | 0.086 | 3.16 (max 17.6) |
| | **adaptive** | **2.47** | **0** | **0** |

(Fixed 0.04 / 0.08 rows in the full CSV: cheaper, but clamp on everything
faster than calm — the static trade-off the adaptive policy escapes.)

## Reading

- **Calm input** (most of real play): adaptive cuts the guard-band pixel tax
  from +73% to +9% — a **37% reduction in total rendered pixels** — with
  identical (zero) artifact rate. This is the bandwidth/GPU saving claim.
- **Hot input**: a fixed 12% margin *does* run out (8.6% of ticks on the hot
  wander, residual error up to 17.6°); adaptive grows to ~0.18 for exactly
  those bursts and clamps **never**, at the price of paying the pixel tax
  only while the burst lasts. This is the quality claim.
- The policy beats the fixed baseline **on one metric or the other on every
  trace, and on both for calm input** — comfortably past the roadmap's exit
  criterion ("beats its baseline on at least one metric with effect size
  worth reporting").

## Honest limits (say these out loud in any write-up)

1. **Simulation-level.** The replay instrument models view-direction error
   and pixel counts, not encoder behaviour. In the live cloud pipeline a
   per-frame FOV change makes the encoder re-spend bits on a globally-changed
   image (and rate control reacts); the saving that survives a real encoder
   must be measured in the cloud demo before the number is quoted as a
   systems result.
2. **Adaptation lag.** The window-max estimator needs the burst to have
   *started* before it can size for it: a cold flick from rest beats the
   window for one frame (`synthFlick` exists in trace.js precisely to poke
   this). The 1.2 safety factor and the 0.02 floor bound, but do not
   eliminate, first-frame clamping on pathological input.
3. **The client must know each frame's guard.** Deployable (it rides the
   pose packet the warp already needs, frame-exact via the pixel tag), but it
   is one more protocol field that must stay in sync — the same class of
   plumbing the frame tag was built to make trustworthy.
