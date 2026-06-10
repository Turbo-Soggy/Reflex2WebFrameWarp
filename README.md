# Frame Warp

A browser-based demo of **motion-to-photon (MtP) latency mitigation** using
frame reprojection ("frame warp"), built with Three.js + WebGL. Same family of
technique as NVIDIA Reflex 2 / frame warp and Oculus ATW.

It is framed as a **single-screen shooting-range demo**: bullseye targets slide
along a track and you track-and-shoot them. The view always runs at 30 FPS with
heavy latency (that's the *condition* being simulated — a demanding game). The
only thing you toggle is **`W` = Frame Warp**. With warp off you fire where you
*were* aiming and miss; press `W` and the view is reprojected to where you *are*
aiming, so you hit. A persistent corner scoreboard tallies accuracy for each mode
(WITHOUT WARP vs WITH WARP) so the comparison survives toggling.

> **Build status: technical demo complete (Stages 1–3 + polish + shooter).**
> Two-clock architecture, guard-band warp, measured latency + chart, CSV export,
> live parameter sliders, and the shooter layer are all in. Remaining: Stage 4
> (report + slides).

---

## How to run

ES modules don't work from a raw `file://` path, so the demo needs a tiny local
web server. From inside the `finalyear` folder:

```bash
npm start            # runs serve.py (no-cache, threaded) on port 8000
# or directly:
python serve.py 8000
```

`serve.py` is a thin wrapper over Python's static server that sends no-cache
headers, so editing a file and reloading always runs the new code (plain
`http.server` returns 304s and serves stale modules). Three.js is **vendored
locally** in `vendor/three/`, so the demo works fully offline — no CDN, nothing
to fail mid-defense.

Then open **http://localhost:8000** in Chrome. Click the screen to enter, move
the mouse to look around.

| Key | Action |
| --- | --- |
| Click (to enter) | Lock the mouse and enter the scene |
| Move mouse | Aim / look around |
| Click (in scene) | Shoot — scored into the current mode's tally |
| `Esc` | Release the mouse |
| `W` | Toggle Frame Warp on/off (the only demo switch) |
| `M` | Toggle motion vectors on/off *(motion-vectors branch)* |
| `D` | Toggle demo mode (hide tech readouts, big scores) |
| `R` | Start / stop recording latency samples |
| `E` | Export the recorded samples as a CSV |
| `T` | Record an input trace; stop downloads JSON for `bench/run.js` (replay system) |

The **parameter panel** (top-right) has live sliders for injected lag, source
frame rate, and guard-band width — press `Esc` to release the mouse, adjust, then
click to re-enter. Hand it to an examiner and let them break it.

The lag is **always on** — it's the simulated condition (a heavy game at 30 FPS),
not a toggle. `W` is the only switch. With warp off the screen shows the raw
lagged frame, so the crosshair points where you were aiming ~95 ms ago and you
miss; press `W` and the frame is reprojected to your *current* aim, so you hit.
That toggle is the core result of the project.

### Motion vectors (the third layer — `motion-vectors` branch)

Camera warp fixes *aim* latency but can't touch a moving object's own motion, so
the laterally-sliding target judders at the 30 FPS source rate (the documented
ATW limitation). The `motion-vectors` branch adds the next layer, the way DLSS
Frame Generation does:

- A second 30 FPS pass renders a **velocity buffer** (`velocity-pass.js` →
  `warp-target.js`'s `velocityRT`): a half-float target storing each pixel's
  screen-space velocity (UV/sec). Static geometry is 0; the target's disc carries
  its projected world velocity.
- The warp shader reads it and adds a **per-pixel** object shift on top of the
  global camera shift: `sampleUV = cameraReproj − velocity · dt`, where `dt` is
  the age of the source frame. Static pixels (velocity 0) are unaffected.
- `M` toggles it. Off → the target steps at 30 FPS; on → it moves smoothly at
  display rate. Together: no warp → laggy aim; `W` → responsive aim, juddery
  objects; `W`+`M` → responsive aim, smooth objects.
- The **hit test is motion-vector-aware**: when `M` is on, the tested target
  position is extrapolated by the *same* `velocity × dt` the shader applies to
  the display, so what you see is what you hit. The two layers compose cleanly —
  `W` (aim orientation) and `M` (object extrapolation) are independent and never
  interfere, in all four on/off combinations.
- **`Shift+M`** drops the source rate to **10 FPS** — at 10 FPS the judder is
  unmistakable, so the `M` toggle's effect is obvious to any judge.

`main` has the stable single-screen demo without motion vectors.

### How the hit detection stays honest

This is important for the thesis. The warp is a **screen-space, camera-rotation**
reprojection — it shifts pixels by the camera's angular delta and nothing else.
It has no target positions and no motion vectors, so it **cannot** compensate for
target motion or disocclusion.

So the shooter does **not** fake a win by testing against different target
*positions* (that would imply the warp moves targets — it can't). Instead, a
single click fires **one** ray, from the camera orientation the screen is
currently **displaying**:

- warp **on** → the *current* orientation (what the reprojected image shows) → hit.
- warp **off** → the *lagged* orientation (what the raw frame shows) → miss while tracking.

The ray tests the real targets. The only thing that changes the outcome is the
camera-rotation latency the warp removes — exactly the quantity the shader
reprojects by.

The targets *move*, which forces you to track (mouse in motion = the only time
lag matters). To keep this honest, target positions are advanced **only on the
30 FPS render tick** (driven by absolute time), so the displayed target and the
ray-tested target are always at the same place. That removes any sub-frame
target-motion error from the warped side — a miss can *still* only come from view
latency. The divergence emerges from the real warp mechanism, and the code path
proves it (`raycast.js`, `targets.js`, and `fire()` in `main.js`).

**To gather data for the report:** press `R`, do a controlled mouse sweep (try
it with warp on, then off, or at different lag settings), press `R` again, then
`E` to download a CSV of timestamped latency measurements you can chart.

### Measurement caveat (read before quoting the numbers)

The chart and CSV report **view-direction latency**, and the two series are *not*
symmetric measurements — be honest about this in the write-up:

- **No-warp** is a real measured quantity: `now − (timestamp of the input the
  displayed frame was rendered with)` — i.e. how stale the shown view direction is.
- **Warp** is the **display-frame interval** — a *proxy floor* for "the warp
  re-applies the freshest input every refresh, so the view is at most one frame
  old." It is **not** a hardware motion-to-photon measurement: it excludes mouse
  polling, GPU queue, and scanout, none of which a browser can observe without
  external instrumentation (e.g. a high-speed camera on the panel).

So the chart shows the *view-direction* latency the warp removes, not absolute
end-to-end MtP. Treat the warp line as a lower bound, and say so when presenting.

## What each file does (study order)

Read them top to bottom — this is the order they build on each other.

1. **`src/input.js`** — the *fast clock*. Samples the mouse on every
   `mousemove` event (125–1000 Hz) and tracks yaw/pitch. This high-frequency
   signal is the raw material the warp will use later.
2. **`src/lag.js`** — the *slow clock*. Caps redraws to 30 FPS and feeds the
   renderer an orientation from a few milliseconds in the past, to simulate
   real pipeline latency in a tunable way.
3. **`src/scene.js`** — the static environment: an indoor **shooting range**
   (concrete floor with painted lanes + distance markers, back/side/near walls,
   ceiling strip lights, parallax posts). All canvas-generated — no downloads,
   works offline. Exports `RANGE` dimensions. Shootable targets live in `targets.js`.
4. **`src/targets.js`** *(shooter)* — bullseye targets that **slide laterally** on
   a track against the back wall (forcing you to track them). Position is a pure
   function of time, advanced only on the render tick so the displayed and
   ray-tested positions match — see the hit-detection note above.
5. **`src/raycast.js`** *(shooter)* — fires a shot from a given camera orientation.
   The honest core: left uses the lagged orientation, right the current one; same
   targets. See the hit-detection note above.
6. **`src/warp-target.js`** *(Stage 2)* — the off-screen render target. The 3D
   scene is drawn into this texture instead of straight to screen, so it can be
   cheaply reprojected afterward. Also remembers the orientation each frame was
   rendered at.
7. **`src/warp-shader.js`** *(Stage 2/3)* — the reprojection fragment shader.
   The mathematical core: `sampleUV = uGuard + (vUv + uDelta) * uScale`. Stage 3
   added the guard band (`uGuard`/`uScale`) so the warp pulls real margin pixels
   instead of clamping; clamp remains only as the large-motion fallback.
8. **`src/quad-render.js`** *(Stage 2)* — draws the texture onto a full-screen
   quad through the warp shader (the single fullscreen viewport).
9. **`src/latency.js`** *(Stage 3)* — measures view-direction latency from real
   `performance.now()` timestamps (lagged vs warped) and buffers the samples for
   the chart.
10. **`src/chart.js`** *(Stage 3)* — the live latency line graph (Canvas 2D). The
   key demo visual: two lines with a steady gap.
11. **`src/recorder.js`** — captures latency samples while recording (`R`) and
   exports them as CSV (`E`) for the report's figures.
12. **`src/hud.js`** — the stats overlay (Source/Warp FPS, latency) **and** the
   `Scoreboard` (WITHOUT/WITH-warp accuracy tallies + the crosshair hitmarker).
13. **`src/main.js`** — the conductor. Owns the renderer and the two-rate loop
   (render scene → texture at 30 FPS, warp → screen at display rate), wires the
   sliders, and handles shooting (`fire()`). Start here once you've skimmed the rest.
14. **`src/style.css`** — pure presentation (HUD, crosshairs, chart, sliders, scores).
15. **`index.html`** — markup + the import map that resolves `three` locally.
16. **`serve.py`** — the no-cache dev server (see “How to run”).
17. **`vendor/three/`** — the vendored Three.js build (r169), so no CDN is needed.

---

## Cloud streaming demo (`cloud-stream` branch)

The same warp, with a **real network** between the two clocks. The pipeline is
split across two browser windows connected by WebRTC: one plays the *cloud
server* (renders the range at 30 FPS and streams it as encoded video), the
other plays the *player* (receives the stream and reprojects it with local
pointer-lock input). The stream the player sees is genuinely 40–150+ ms old;
the view direction is one display frame old.

**Run it:** `python serve.py`, open `http://localhost:8000/server.html`, click
**“Open player window”**. The pages handshake automatically through
`localStorage` (same-origin signaling — no STUN/TURN, localhost only) and
auto-heal if either window is reloaded.

**Demo script:** set 80 ms delay, warp off → sluggish. Press `W` → instant.
Crank to 150 ms → still instant. Jitter on, warp off → unplayable. `W` →
perfectly stable. *“The video is 150 ms old. The view direction is one display
frame old — ~17 ms on this monitor.”*

### The cloud files (study order, after the local demo)

1. **`src/cloud/signaling.js`** — localStorage as the signaling server:
   same-origin `storage` events carry the offer/answer SDP between windows.
   Session ids guard against stale handshakes; ICE is non-trickle (localhost).
2. **`src/cloud/frame-tag.js`** — the frame-matching answer. The server bakes
   each frame's id into a 4×4 black/white pixel grid in the corner (16 bits,
   16 px cells); the client reads it back from the decoded video. Exact by
   construction; the corner lives in the guard band so the crop hides it.
3. **`src/cloud/pose-sync.js`** — client ring buffer of pose packets.
   `byFrameId()` (from the tag) is primary; timestamp matching ("Plan A") is
   kept and *scored live against the tag*: ~99.5 % agreement on a calm
   network, degrading to ~95 % under jitter — measured justification for the
   tag-primary design.
4. **`src/cloud/server-main.js`** — the cloud server page: fixed 1280×720
   capture (the encoder must never rescale mid-stream;
   `degradationPreference: 'maintain-resolution'`), 30 FPS render loop, the
   **simulated network** (delay queue in front of capture + the same one-way
   delay on incoming input; jitter wanders the delay 40–140 ms without ever
   reordering frames), and the DataChannel (unreliable + unordered, like a
   real game-streaming control channel).
5. **`src/cloud/client-main.js`** — the player page: `<video>` →
   `THREE.VideoTexture` → **the same `QuadRenderer`/warp shader as the local
   demo**, driven by `(local pose − displayed frame's pose)` per display
   refresh. Forwards input as full-pose latest-wins packets (~120 Hz). Reuses
   `Latency`/`LatencyChart` for the live chart and extends `Recorder` for CSV.
6. **`src/cloud/cloud-recorder.js`** — CSV export with a per-mode summary
   block (mean/p95/p99 of the *perceived* view-direction latency).

### The headline numbers (measured on loopback)

| One-way delay | e2e latency, warp off | View latency, warp on |
|---|---|---|
| 40 ms  | ~150 ms | ~17 ms |
| 100 ms | ~264 ms | ~17 ms |
| 160 ms | ~381 ms | ~17 ms |

Warp-off tracks the round trip linearly (slope 2 plus ~65 ms of codec +
frame-interval overhead); the warp line is flat at one display-frame interval
regardless of network delay — and it is *mathematically immune to jitter*,
because the delta is computed per displayed frame and is exact whatever that
frame's age.

### What survives the network (honest capability table)

| Capability | Local demo | Cloud demo | Why |
|---|---|---|---|
| Rotation warp | ✅ | ✅ | Only needs the pose delta |
| Guard band | ✅ | ✅ | Server renders the wide FOV; client crops |
| Motion vectors | ✅ | ❌ | The stream is YUV 4:2:0 video — no channel exists for per-pixel velocity, and chroma subsampling + lossy quantisation would destroy its precision anyway |
| De-ghosting clamp | ✅ | ✅ | Shared shader (with no velocity term it is mathematically inert; it exists for the local demo's motion vectors) |

---

## The core idea (one paragraph)

A 30 FPS display only shows a new frame every ~33 ms, but the mouse reports
motion far faster. So we run two clocks: input is sampled continuously, while
the world is only *redrawn* at 30 FPS. We render that slow frame to a texture
and then, every display refresh, **warp** the texture using the freshest mouse
input — sliding it by the camera's angular motion since the frame was drawn
(`Δu = −Δyaw / fov_x`, `Δv = Δpitch / fov_y`). The image responds immediately
even though the underlying 3D frame is old. To avoid stretched edges when the
image slides, the scene is rendered at a **wider FOV than shown** (a guard band),
so the warp pulls real pixels from the margin; `clamp` is only the fallback when
motion exceeds the margin. The 12% margin is tuned for typical gaming
sensitivity — pathological input velocities can exhaust it in a single frame and
fall back to edge clamping — and it costs GPU since we render more than we show.
The warp also can't reconstruct *occluded* geometry or moving objects (no motion
vectors) — that's the documented limitation and the motivation for future work.

---

## Roadmap

- [x] **Stage 1** — Scene, mouse-look, 30 FPS lag sim, split-screen, stats.
- [x] **Stage 2** — Render-to-texture + the warp fragment shader (angular reprojection).
- [x] **Stage 3** — Guard-band edge in-painting, post-warp UI crosshairs, measured latency + live chart.
- [x] **Polish** — Local Three.js, no-cache dev server, parameter sliders, CSV export, procedural textures.
- [x] **Shooter** — Indoor range, laterally-moving targets, honest camera-orientation hit detection, slim accuracy scoreboard, demo mode (`D`).
- [x] **Single-screen** — Lag hardcoded always-on; collapsed the split into one fullscreen viewport; `W` toggles Frame Warp; persistent WITHOUT/WITH-warp scoreboard.
- [x] **Cloud streaming** (`cloud-stream` branch) — the pipeline split across WebRTC: server/player windows, pixel-tag pose sync, simulated delay + jitter, end-to-end measurement + CSV. Stages C1–C5 of the cloud plan; see the section above.
- [x] **Research program, machine-executable subset** (`cloud-stream` branch) — Phases 0–3 of `RESEARCH_ROADMAP.md`, status tracked honestly in `FRAME_WARP_TASKLIST.md`:
  - *Phase 0*: landscape baseline memo + revised novelty claim (`docs/PHASE0_WHAT_CHANGED.md`).
  - *Phase 1*: deterministic replay system (`src/replay/`, `T` key records traces) + headless benchmark (`bench/run.js`) — bit-identical across runs. Hardware rig + IRB blocked (need a desk with hardware and a university).
  - *Phase 2*: theory layer (`docs/THEORY.md` — decomposition, jitter-immunity theorem, error bounds, all validated by the instrument) + related-work survey (`docs/RELATED_WORK.md`, 28-entry `docs/references.bib`).
  - *Phase 3, Option C*: velocity-adaptive guard band (`src/replay/adaptive-guard.js`, `bench/adaptive.js`, results in `docs/ADAPTIVE_GUARD.md`) — calm input cuts the guard pixel tax +73% → +9%; hot input eliminates clamping. Simulation-level; encoder effects unmeasured.
  - *Phases 4–5* (user study, paper) blocked on humans + ethics approval, by design.
- [ ] **Stage 4** — Report (DOCX) + slides (PPTX).
