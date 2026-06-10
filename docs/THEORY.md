# Theory: what the rotation warp removes, and where it breaks

> Phase 2 of the research roadmap. Claims become statements with stated
> limits. Every analytic result here is validated against the replay
> instrument (`src/replay/pipeline-sim.js`) in `test/test.js` — theory checked
> by the project's own measurement machinery, not by eye.

Notation: display FOV `F` (horizontal, radians; `F = fovX ≈ 1.877` for the
demo's 75° vertical at 16:9), `T = tan(F/2)`, guard band `g` (texture-relative,
default 0.12), `uScale = 1 − 2g`, injected/network latency `L`, render interval
`T_r = 1/renderHz`, display interval `T_d = 1/displayHz`, angular velocity `ω`.

---

## 1. The latency decomposition

End-to-end motion-to-photon latency for a streamed (or heavily pipelined)
renderer decomposes as

```
L_total = L_input + L_uplink + L_render + L_encode + L_downlink + L_decode + L_composite
```

For the local demo, the uplink/encode/downlink/decode terms collapse into the
injected `lagMs`; for the cloud demo each term is physically present (WebRTC
uplink, 30 FPS render wait, H.264/VP8 encode, the delay queue, decode).

**Claim 1 (what the warp removes).** For *camera rotation*, client-side
reprojection replaces every term except the last:

```
L_rotation-to-photon  =  L_composite  ≤  T_d        (one display refresh)
```

*Why:* the compositor reads the freshest local pose every display refresh and
shifts the most recent decoded frame by the pose delta. The displayed view
direction therefore reflects input sampled at most one composite interval ago,
no matter how old the underlying pixels are. The cloud measurements show
exactly this: e2e no-warp latency rises ~150 → ~381 ms as one-way delay goes
40 → 160 ms, while the warped view-direction latency stays flat at ~17 ms (one
60 Hz refresh) — the README headline table.

**Claim 2 (what it cannot remove).** Every other interaction keeps the full
`L_total`:

- *interaction-to-photon* (shooting, world changes): the click must round-trip
  to the renderer; nothing client-side can shortcut a state change it cannot
  compute.
- *object-motion-to-photon*: a moving object's position is baked into the
  pixels. The local demo's motion-vector layer addresses this; over a video
  stream no velocity channel exists (YUV 4:2:0, lossy), so the cloud demo
  documents this as out of scope rather than pretending otherwise.
- *translation* (strafing/walking): rotation warp models the view as a pure
  rotation about the optical centre; translation produces depth-dependent
  parallax it cannot synthesise (§4).

## 2. The jitter-immunity theorem

**Theorem.** Let the displayed frame at composite time `t` have arbitrary age
`A(t)` (any distribution — fixed delay, jitter, bursts). If the pose delta
satisfies `|Δyaw| ≤ Δmax` (§3), the displayed view direction equals the input
pose sampled at `t` exactly; hence perceived rotation latency is `≤ T_d`,
**independent of both the mean and the variance of `A`**.

*Proof.* The compositor computes `Δ = pose_now − pose_frame`, where
`pose_frame` is recovered exactly (the cloud pipeline's pixel frame-tag makes
this exact by construction, not estimated). The warp applies the UV shift
corresponding to `Δ` in full whenever it is within the guard margin. The
frame's age determines only *which* `pose_frame` enters the subtraction — the
subtraction then cancels it. ∎

Two honest conditions: (i) the delta must stay within the guard band — jitter
*does* widen the distribution of `Δ`, so it raises the *clamp probability*
(§3) even though it cannot touch the latency of unclamped frames; (ii) frame
pose recovery must be exact — with timestamp matching instead of the pixel
tag, jitter degrades match accuracy (measured: ~99.5% calm → ~95% jittered),
which is precisely why the tag is primary.

This is the formal content of the demo observation "jitter on, warp off →
unplayable; warp on → indistinguishable from a calm network."

## 3. Error bound I: guard-band exhaustion

The shader samples `sampleUV = g + (vUv + δuv)·uScale`. At the screen edge
(`vUv = 1`) the sample leaves the texture once `δuv > g/uScale`, so the
largest compensable rotation is

```
Δmax = (g / uScale) · F          = 16.98°  at g = 0.12, F = 107.5°
```

A displayed frame's age in steady state lies in `[L, L + T_r + T_d]`: it is
`L` old the instant it is rendered, ages up to one render interval before
replacement, and the replacement can land one display tick late because
renders are quantised to display ticks. (The first draft of this bound omitted
the `T_d` term; the replay instrument caught it — the simulator's measured
max staleness of 116.7 ms exceeded the naive 113.3 ms bound.)

At constant angular velocity `ω`, clamping begins somewhere in

```
ω* ∈ [ Δmax / (L + T_r + T_d) ,  Δmax / L ]
```

For the default configuration (L=80 ms, 30 FPS render, 60 Hz display):
**ω\* ∈ [130.6, 212.2] deg/s**; the simulator measures onset at ~143 deg/s
(`test/test.js`, "measured clamp onset falls within the analytic bounds";
sweep CSV: `node bench/run.js --sweep-velocity 60:260:5`). Past onset the
residual error grows linearly: `err = ω·A − Δmax` for the worst-age frames —
visible in the sweep as `err_warp_p95` rising with slope ≈ A_max.

The same expression inverts into a *guard-band sizing rule* (used by the
Phase 3 adaptive experiment): to absorb velocity `ω` at age bound `A`,

```
g ≥ s / (F + 2s)   where  s = ω·A     (solve Δmax(g) = s)
```

## 4. Error bound II: where the linear shift itself is wrong

The shader's shift is *uniform in UV* — linear in angle — but a perspective
image is linear in `tan(angle)`. Exact compensation of a yaw `δ` would remap
each output pixel at angle `θ` from centre to the source angle `θ+δ`:

```
u_exact(θ)  = ½ + tan(θ+δ) / 2T          (the true 1-D homography)
u_applied(θ) = ½ + tanθ/2T + δ/F          (what the shader does)
```

First-order error in UV per radian of delta:

```
e(θ)/δ  =  sec²θ / 2T  −  1/F
```

- **Zero crossing:** the uniform shift is *exact* where `sec²θ = 2T/F`,
  i.e. `θ ≈ ±34°` at the demo FOV — partway between centre and edge. The
  `δ/F` normalisation is therefore a least-worst compromise across the frame
  (the alternative `δ/2T` would be exact at centre but undershoot everywhere
  else).
- **Screen centre** (`θ=0`): `e/δ = 1/2T − 1/F = −0.166` UV/rad → the centre
  over-slides by ≈ 213 px per radian of delta at 1280 wide (45% more than the
  tangent-exact shift).
- **Screen edge** (`θ = F/2`): `e/δ = +0.516` UV/rad — under-slides, opposite
  sign, ~3× the centre magnitude.

The delta the warp applies is the full frame-age delta, `δ ≈ ω·A` — not one
display frame's worth — so this error is not negligible during fast rotation:
brisk tracking at 60 deg/s with a 100 ms-old frame gives δ ≈ 6°, i.e. centre
pixels land ~22 px from where exact reprojection would put them, converging
to 0 as the rotation stops. Verified numerically in `test/test.js` ("uniform
UV shift is exact at sec²θ = 2T/F"). The exact fix is a per-pixel tangent
remap (a 1-D homography — same cost class as the current shader); kept as
future work since every measured number in the project used the linear form,
and the error vanishes exactly when aim needs to be precise (when the mouse
stops, δ → 0).

## 5. Error bound III: translation parallax (why rotation-only is the floor)

For camera translation `v` (m/s) over frame age `A`, a point at depth `d`
shifts by parallax angle `≈ v_⊥·A / d` (small angles, `v_⊥` the component
perpendicular to the view ray). The warp applies none of it, so the screen
error is

```
err_px ≈ (W / F) · v_⊥ · A / d        (W = screen width in px; W/F ≈ px per rad)
```

Walking speed (1.5 m/s) at A = 150 ms against geometry 2 m away: ~0.11 rad ≈
77 px at 1280 — *large*; the same motion against 50 m geometry: ~3 px —
invisible. This is the quantitative version of "rotation warp works because
rotation dominates and parallax falls off with depth," and it is the
motivation for the roadmap's Option A (streamed low-res depth): depth turns
this whole term from error into signal.

Disocclusion is the limit case (`d` discontinuity): no image-space warp can
synthesise pixels that were never rendered; the guard band covers rotation
only.

## 6. Summary table

| Quantity | Expression | Default-config value | Validated by |
|---|---|---|---|
| Rotation-to-photon, warp on | `≤ T_d` | ~17 ms @ 60 Hz | cloud demo CSV; sim |
| Frame age bound | `[L, L + T_r + T_d]` | [80, 130] ms | sim staleness test |
| Max compensable rotation | `(g/uScale)·F` | 16.98° | clamp-onset test |
| Clamp onset (constant ω) | `Δmax/age` | 130.6–212.2 deg/s | sweep + test |
| Linear-shift error | `δ·(sec²θ/2T − 1/F)` | exact at θ≈±34° | linearisation test |
| Parallax error | `(W/F)·v_⊥·A/d` | scene-dependent | analytic only* |

\* The demo camera never translates, so the simulator cannot measure this
term; it is stated as a bound, not a measurement — hardware/user-study phases
would exercise it.
