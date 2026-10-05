# Presenter plan: scripted scenarios on number keys

Outcome of a three-reviewer audit (browser play-through, presentation-layer code
audit, viva-script design), synthesised 2026-09-23. Goal: make the local demo
something a presenter can drive like a vendor tech demo, where each number key
plays a self-contained scenario, hands-free, with the mechanism visible on a
projector.

## Diagnosis (why "more hotkeys" is the wrong fix)

1. The core effect is felt in the hand, not seen. The audience never sees the
   mouse, so warp ON and OFF look identical on a projector apart from a 0.95 s
   caption and 12 px corner text. Nothing on screen shows the mechanism.
2. The demo has 15 keys but no sequence, no on-screen feedback for most, and
   several that fight each other (attract loop, onboarding, summary-on-Esc,
   A/B test, feel-the-lag) or download files (E, T).
3. Two honesty defects would be exposed by any side-by-side view and by any
   examiner who reads the code:
   - `main.js` `applyWarpLag()`: W sets injected lag to 150 ms (off) / 50 ms
     (on). The onboarding says "same lag", the summary card prints
     "cut injected lag 150 → 50 ms", the README says W is the only switch.
   - `shooter.js` `fire()`: targets are rewound to the displayed frame only when
     warp is on and tracking. Warp off tests the present. The README claims the
     opposite ("does not test against different target positions").
   - `heatmap.js` `update()`: with warp on, the displayed pose is defined as
     the fresh pose, so the collapse is by construction, not measured.

## Phase 0: honesty fixes (do first, ~1 h)

- Remove the W→lag coupling. Lag is one fixed value (start at 120 ms), shown
  on the HUD, and does not move when W is pressed. Fix onboarding, summary and
  README text. Re-check the README headline numbers were not produced with the
  coupling on.
- Hit test: always rewind targets to the displayed frame time in both modes
  (`hitTime = getLastRenderedElapsed()`); ray from the current aim. Verify the
  warp-off miss rate in the browser after the change and update README §"How
  the hit detection stays honest" to match the code.
- Heatmap: derive the displayed pose from what the compositor actually drew
  (rendered pose + applied delta), not from the warp flag.
- Latency chart: raise `maxMs` so the no-warp line is not pinned to the top.
- Add `e.repeat` guard on the key handler.

## Phase 1: presenter mode and autopilot (~2 h)

`?present` URL flag or `P` key:
- Disable attract loop, onboarding, summary-on-Esc, and the R/E/T download
  keys. Keep the scene visible while unlocked (transparent overlay, no card).
- `F` fullscreen. Big captions (≥ 28 px) and a large permanent WARP ON/OFF badge.
- Autopilot: pull the sine sweep out of `attract.js` into a camera driver that
  runs while unlocked, stops on real mouse motion, is not cancelled by keys.
  This gives identical input across the W toggle and survives lost pointer
  lock, 60 Hz projectors and nervous hands.
- On-scene true-aim ghost reticle (where the hand is now) vs the crosshair
  (what the screen shows) so the gap is visible from the room.

## Phase 2: the three mechanism views

Cross-cutting change: `QuadRenderer.render` takes an optional viewport rect;
set viewport + scissor together (autoClear is on, so a second draw would
otherwise wipe the first).

- Freeze / step (~30 min). `LagSim.paused` + `stepOnce()`. Warp keeps
  responding, no new source frames. Disable shooting, skip latency sampling
  and motion vectors while frozen. Also let the Hz slider go down to 2.
- Guard-band zone tint (~30 min). Shader flag: cyan where the sample comes
  from the margin, red where it clamped. Guard 0 % + a flick = all red.
- Side-by-side (1–2 h). Two quad draws from the same texture, letterboxed
  halves at full FOV: left delta 0 ("raw 30 FPS frame, 120 ms old"), right
  warped ("same frame, reprojected to now"). Two crosshairs, divider, shooting
  disabled. No extra 3D render.
- X-ray (~½ day). Second QuadRenderer with guard 0 draws the whole wide-FOV
  texture; a DOM rectangle at
  `left=(G+du·S)·W, top=(1−(G+dv·S)−S)·H, size=S·W×S·H` shows the crop the
  shader is sampling, updated from the same du/dv as the shader. Markers for
  "frame rendered aiming here" vs "aiming here now", readout of Δyaw/Δpitch,
  frame age, guard used %. Dashed centre rectangle = "warp off never moves".

## Phase 3: scenario chapters (~1 day, last, composes everything)

Keys `1`–`9`, plus PageDown/PageUp for a clicker, `0` resets scores. Each
chapter is an idempotent full state preset (warp, lag, Hz, guard, MV, view,
frozen, charts, caption) plus a lower-third caption and a "you are here" strip.

| Key | Scenario | State | Audience sees |
|---|---|---|---|
| 1 | Responsive baseline | 60 FPS, 0 ms, warp off, autopilot | view tracks the reticle exactly |
| 2 | The problem | 30 FPS, 120 ms, warp off | reticle runs ahead of the image; gap visible |
| 3 | The fix | same lag, warp on | gap collapses; lag readout unchanged |
| 4 | Side by side | split view | left lags, right doesn't, same frame |
| 5 | How it works | x-ray | crop rectangle slides then snaps on each new frame |
| 6 | Freeze | source paused, warp on | image slides with zero new frames; step key |
| 7 | Guard band limits | zone tint, guard 0/12/30 | cyan margin, red clamp on hard flicks |
| 8 | What it can't fix | 10 FPS, warp on, M off→on | target judders, M smooths it |
| 9 | Jitter immunity (optional) | LagSim jitter | warp off judders, warp on steady |

Needed API additions: `feelTheLag.stop()`, `heatmap.set()`, `abtest.cancel()`,
`onboarding.cancel()`, `attract.disable()`, quiet option on `setWarp`, replace
the `dataset.prev` slow-mo hack. Onboarding must be off or it overwrites
chapter captions.

## Deliberately not doing

- More one-off hotkeys.
- A live "ground truth" third panel (second full 3D render per display frame;
  can drag the frame rate being demonstrated).
- The cloud WebRTC beat live unless rehearsed on the exact laptop + projector;
  otherwise a recorded clip. `assets/frame-warp-demo.mp4` is referenced but
  missing: record one.
- Hiding the defects. Fix them.

## Live hazards to rehearse

- Guard 30 % on a HiDPI laptop allocates a ~9600 px render target (over the
  8192 limit on many iGPUs). Cap the slider or the texture size.
- Mirrored vs extended display changes the refresh rate and so the "17 ms" line.
- Present from `?present&nointro`, muted, on AC power, high-performance GPU.
- Keynote numbers disagree with the repo (39 vs 64 tests, +33 % vs +9 %,
  80 ms vs 150/50 ms). Reconcile before the viva.
