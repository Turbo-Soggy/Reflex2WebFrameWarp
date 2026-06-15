# THE HEADLINE CRITIQUE

**Your warp is a uniform UV shift that is physically wrong, and your entire measurement apparatus is calibrated to hide that fact.**

The warp shader performs `sampleUV = uGuard + (vUv + uDelta) * uScale`. This is a **linear UV shift** — it slides the image by the same amount everywhere. But perspective projection is linear in *tangent*, not in angle. The correct reprojection for a camera rotation δ around the vertical axis is:

```
newU = atan(tan(oldAngle) + tan(δ)) / FOV
```

Your shader instead does `newU = oldU + δ/FOV`. These diverge as `sec²(θ)` — at the 75° vertical / ~107° horizontal display FOV you use, the edge-of-screen error at the maximum warp delta is ~15–20% of a pixel per pixel of shift. You *know* this (THEORY.md §4, test/test.js line 442), and the pipeline-sim carefully limits itself to centre-of-screen view-direction error (where the linearisation is exact). But the demo that an examiner sees — the full-screen shooter with the moving target — shows the *entire* warped image, including the 30% of the viewport where the linearisation is worst. The guard-band edge clamp then smears already-wrong pixels. You never measure or report per-pixel reprojection error anywhere in the live demo. The latency chart and the accuracy scoreboard both operate on view-direction (screen centre) quantities, where your linear approximation happens to be perfect.

This is the load-bearing flaw: **you built your measurement to succeed where your shader is correct, and your demo hides the region where it isn't.**

---

# 1. THE "SMOKE AND MIRRORS" CHECK

## 1.1 Latency Measurement is Circular

[latency.js](file:///c:/projects/finalyear/src/latency.js): The "warp" latency series is defined as `warpEnabled ? frameInterval : noWarp` (line 56). When warp is on, you report the *display frame interval* (~16 ms) as the "view latency". But this is not a measurement — it is the *definition* you chose. You're measuring "how often do I composite?" and calling it "latency". The README even admits this (line 130: "a proxy floor… not a hardware motion-to-photon measurement"), but the chart on screen doesn't carry that caveat, and a non-technical examiner will read "16 ms" as "16 ms latency".

**The honest number you don't have:** the GPU render queue delay, the compositor scheduling delay, the scanout position, and the display panel's pixel response time. On a 60 Hz display with double buffering, your true motion-to-photon is at minimum 16.7 + 8 (half scanout) + 5 (pixel response) ≈ 30 ms, not 16 ms. The warp helps, but the chart overstates the improvement by ~2×.

## 1.2 Hit Detection is Subtly Biased Toward Warp-On

[shooter.js](file:///c:/projects/finalyear/src/shooter.js#L36-L75): The `fire()` function on line 44–47:

```js
const isTracking = Math.abs(yaw - ctx.warpTarget.renderedYaw) > 0.01;
const hitTime = (ctx.getWarpEnabled() && isTracking)
  ? ctx.getLastRenderedElapsed()
  : ctx.clock.getElapsedTime();
```

When warp is **on** and the user is tracking, you test against `lastRenderedElapsed` (the lagged target positions the *display* shows). When warp is **off**, you test against `clock.getElapsedTime()` (the *real-time* target positions). This means:

- **Warp on + tracking:** you test the ray against where the target *was* (lagged) — consistent with the lagged *display*, so a visual hit is a logical hit. Correct.
- **Warp off + tracking:** you test the ray against where the target *is now* — but the *display* shows where it *was*. The user is aiming at the stale display position, but the test is against the current position. This makes **warp-off accuracy worse than it would be with a fair test**.

You've built a bias that punishes the no-warp condition with two separate sources of error (stale view direction *and* advanced target position), while the warp condition only suffers one (the target is always at the displayed position). This inflates the accuracy delta. A fair test would test against `lastRenderedElapsed` in *both* branches.

## 1.3 Synthetic Traces Are Not Human

[trace.js](file:///c:/projects/finalyear/src/replay/trace.js): `synthWander` is a damped random walk with an LCG. Real human mouse input has entirely different spectral characteristics — ballistic flicks, corrective micro-adjustments, and long stationary holds. Your Ornstein-Uhlenbeck process produces smooth, bounded wandering that stays comfortably within the guard band. You calibrate the adaptive guard (`bench/adaptive.js`, `docs/ADAPTIVE_GUARD.md`) against this smooth synthetic, then claim "+73% → +9% pixel savings". A real human flick-and-hold pattern would likely blow through the guard band with regularity the synth never exhibits.

## 1.4 The "Honest" Cloud Latency Numbers Are Loopback

The table in README line 239 ("40 ms → ~150 ms → ~17 ms") is measured on localhost, where the WebRTC encoder runs on the same GPU as the decoder, network jitter is zero, and both clocks are on the same machine. On a real network with packet loss, reordering, and encoder quality adaptation, the frame tag readback (client-main.js `readFrameTag`) will degrade — the 4×4 binary threshold at 127 (line 192: `sum / 16 > 127`) has no error correction and no margin against YUV chroma subsampling artefacts near cell boundaries.

---

# 2. WASTED EFFICIENCY

## 2.1 The Velocity Pass Renders Each Mesh as a Separate draw call

[velocity-pass.js](file:///c:/projects/finalyear/src/velocity-pass.js#L69-L76): For every target mesh, you swap its material, call `renderer.render(mesh, camera)` (a full scene render with state setup/teardown), then restore the material. This is catastrophically expensive per-mesh — full pipeline flush, shader rebind, uniform uploads, every time. With one target it's invisible; with N it would be N full render calls per 30 FPS tick.

The correct approach: an instanced draw with the velocity encoded per-instance (a single `uVel` attribute or uniform array), or — since all targets share the same velocity material — batch all meshes into a single render call with per-object velocity packed into a vertex attribute.

## 2.2 `history.shift()` in LagSim is O(n)

[lag.js](file:///c:/projects/finalyear/src/lag.js#L47-L49): `this.history.shift()` is O(n) in V8 for the typical array length here (~30–250 entries). Called potentially multiple times per frame. A ring buffer with head/tail indices would be O(1) and avoids GC churn from the discarded objects.

Same pattern in [latency.js](file:///c:/projects/finalyear/src/latency.js#L71) (`buf.shift()`) and [pipeline-sim.js](file:///c:/projects/finalyear/src/replay/pipeline-sim.js#L134) (`speeds.shift()`), and [pose-sync.js](file:///c:/projects/finalyear/src/cloud/pose-sync.js#L51) (`this.poses.shift()`). You use `shift()` on every ring buffer in the project. None of them are actual ring buffers.

## 2.3 The De-Ghost Pass Runs Unconditionally

[warp-shader.js](file:///c:/projects/finalyear/src/warp-shader.js#L98-L109): The 3×3 neighborhood clamp runs on **every pixel of every frame**, regardless of whether motion vectors are enabled or whether the warp delta is zero. Nine texture fetches per fragment for a pass that is, in the `uMotionVectors = 0` codepath, provably a no-op (the sampled color IS the neighbourhood centre). A `if (uMotionVectors < 0.5) { gl_FragColor = warpedColor; return; }` early-out would skip 8 texture fetches per pixel — at 1080p that's ~16 million saved fetches per frame.

## 2.4 `getVelocities()` Allocates a New Array Every Call

[targets.js](file:///c:/projects/finalyear/src/targets.js#L80-L82): `return this.meshes.map(m => m.userData.vel)` creates a new array and iterates all meshes every time. Called from both the render loop and the shooter. Trivially avoided with a persistent array updated in `update()`.

## 2.5 `setInterval` for Input Forwarding in the Cloud Client

[client-main.js](file:///c:/projects/finalyear/src/cloud/client-main.js#L311-L316): `setInterval(() => { ... dc.send(...) }, 1000/120)` is not synchronised with rAF. `setInterval` has a minimum resolution of 4 ms in most browsers and can fire from a different task queue than animation frames. The input forwarded at ~120 Hz drifts relative to the composite loop. Since you're sending latest-wins full-pose packets, the drift doesn't corrupt data, but the `setInterval` fires while the page is in the background (wasting bandwidth) and the 120 Hz target can't be met on a 60 Hz display (you're doubling network traffic for no benefit when the display can only show 60 updates).

---

# 3. ARCHITECTURAL OVER/UNDER-ENGINEERING

## 3.1 Cloud Demo Duplicates the Entire Pipeline

[server-main.js](file:///c:/projects/finalyear/src/cloud/server-main.js) and [client-main.js](file:///c:/projects/finalyear/src/cloud/client-main.js) each reimplement the render loop, the camera orientation logic, the guard-band constants, and the FOV math from scratch. Constants like `DISPLAY_FOV_Y = 75`, `GUARD = 0.12`, `UV_SCALE = 1 - 2 * GUARD` appear in three separate files (main.js, server-main.js, client-main.js). If you change the guard band in one, the other two silently diverge. There is no shared configuration module.

## 3.2 The `ctx` Accessor Pattern is Over-Engineered State Injection

[shooter.js](file:///c:/projects/finalyear/src/shooter.js) and [controls.js](file:///c:/projects/finalyear/src/controls.js) receive a `ctx` object full of getters/setters (`getWarpEnabled`, `setWarpEnabled`, `getMotionVectorsOn`, etc.) — 12 accessors in total. This is a handrolled dependency-injection container for what is, in practice, a single-module application. A shared state object with plain properties would be simpler and fewer lines. You introduced the accessor pattern to keep main.js "owning" the state, but nothing prevents the controls module from doing `ctx.setWarpEnabled(true); ctx.setWarpEnabled(false);` in the same tick. There's no state machine, no transitions, no guards — the complexity of injection without any of its safety benefits.

## 3.3 The Test Harness is Hand-Rolled for No Good Reason

[test/test.js](file:///c:/projects/finalyear/test/test.js): 627 lines of custom test infrastructure including a hand-coded `test()` runner, `approx()` helper, `section()` grouping, and ANSI coloring — all to avoid `node:test` (available since Node 18) or any test framework. The custom harness lacks: parameterised tests (so the same assertion pattern is copy-pasted across test cases), test isolation (all tests share `passed`/`failed` global counters), before/after hooks, and async test support. Given that you already use `node:assert/strict`, you are one `import { test, describe } from 'node:test'` away from a proper runner with zero dependencies.

## 3.4 Under-Engineered: No Error Handling in the Cloud Pipeline

The DataChannel `message` handlers in both server-main.js and client-main.js call `JSON.parse(e.data)` with zero error handling. On an unreliable, unordered channel, partial or corrupted messages are possible. One bad JSON string crashes the event handler and silently stops all subsequent message processing. A `try/catch` around the parse is the minimum.

---

# 4. HIDDEN ASSUMPTIONS

## 4.1 Pointer Lock Assumes a Desktop With a Mouse

The entire demo requires `requestPointerLock()` and `movementX`/`movementY`. This excludes: touch devices, trackpads (which report `movementX` but with very different sensitivity), any browser that restricts Pointer Lock (some enterprise configurations), and VR headsets (which would be the natural home for this technique — the README name-drops Oculus ATW on line 4 but can't run on an Oculus). The README says "a desktop browser (Chrome/Edge/Firefox)" on line 73, but the code doesn't check for `requestPointerLock` existence and will throw on Safari iOS.

## 4.2 `mousemove` Event Coalescing

[input.js](file:///c:/projects/finalyear/src/input.js#L60-L71): You accumulate `movementX`/`movementY` on every `mousemove` event. Modern browsers coalesce mouse events between frames — `getCoalescedEvents()` can return 4–8 sub-events per dispatched `mousemove`. You count each dispatched event as one in `eventCount`, so the HUD's "Input rate: 125 Hz" is the *dispatched* rate, not the *hardware polling* rate. The actual hardware rate may be 1000 Hz with 8× coalescence, making the displayed number misleading. More importantly, the *timing* of each sub-event is lost — you only see the aggregate delta, which introduces up to 8 ms of implicit jitter that you never measure.

## 4.3 `requestAnimationFrame` Cadence is Display-Dependent

The warp's value proposition is predicated on "the display refreshes at 60+ Hz while the scene renders at 30 FPS." On a 30 Hz display (some external monitors, a laptop in battery-saver mode), rAF fires at 30 Hz — the same rate as the scene render — and the warp has zero intermediate frames to fill. The demo doesn't detect or warn about this. On a 240 Hz gaming monitor, the composite loop runs 8× per render tick, which is 8× the de-ghost shader cost and 8× the texture samples per second. The README's "~17 ms at 60 Hz" warp latency becomes "~4 ms at 240 Hz" — more impressive but also more wrong (the real motion-to-photon floor doesn't scale that way because GPU queue and scanout are fixed).

## 4.4 `performance.now()` Precision

The latency measurements rely on `performance.now()` sub-millisecond precision. Post-Spectre, browsers have reduced `performance.now()` precision to 100 μs (Chrome) or 1 ms (Firefox with `privacy.reduceTimerPrecision`). Your measured "warp latency" of ~16.7 ms has a potential ±1 ms measurement floor that you never characterise.

## 4.5 `serve.py` is an Open Directory Traversal

[serve.py](file:///c:/projects/finalyear/serve.py): `SimpleHTTPRequestHandler` serves every file under the working directory, including `.git/` (which contains your entire commit history, credentials in any committed config, etc.). The `POST /log` endpoint writes arbitrary data to `server.log` without size limits — a trivial denial-of-service. Not a problem for localhost development, but the README instructs users to "open http://localhost:8000" without any warning, and any software on the machine can reach it.

---

# 5. COGNITIVE BAGGAGE

## 5.1 Guard-Band Constants are Defined in 4 Places

- [main.js](file:///c:/projects/finalyear/src/main.js#L56): `guard = 0.12`, `uvScale = 1 - 2 * guard`
- [server-main.js](file:///c:/projects/finalyear/src/cloud/server-main.js#L37-L38): `GUARD = 0.12`, `UV_SCALE = 1 - 2 * GUARD`
- [client-main.js](file:///c:/projects/finalyear/src/cloud/client-main.js#L38): `GUARD = 0.12`
- [pipeline-sim.js](file:///c:/projects/finalyear/src/replay/pipeline-sim.js#L40): `guard: 0.12`

Change one, break three. This is a maintenance trap that will bite during report writing when an examiner asks "what if guard is 15%?".

## 5.2 The `applyWarpLag` Side-Effect is Invisible

[main.js](file:///c:/projects/finalyear/src/main.js#L225-L230): Toggling warp on/off also silently changes the injected lag (150 ms → 50 ms) by programmatically driving the lag slider. This means the "WITH WARP" vs "WITHOUT WARP" comparison is **not** apples-to-apples: warp-off runs at 150 ms injected lag while warp-on runs at 50 ms. The scoreboard labels imply the only variable is the warp toggle, but the lag is also changing. An examiner who notices the slider jumping will question the integrity of the comparison.

> [!CAUTION]
> This is arguably your second-most critical flaw after the linearisation issue. Your headline result — "warp on = more hits" — is confounded with a 3× lag reduction. You cannot claim the warp alone causes the accuracy improvement when you simultaneously reduce the lag.

## 5.3 Duplicated FOV Calculation

The formula `2 * Math.atan(Math.tan(fovY / 2) * aspect)` appears in:
- [main.js](file:///c:/projects/finalyear/src/main.js#L317) (inline)
- [client-main.js](file:///c:/projects/finalyear/src/cloud/client-main.js#L127) (inline)
- [pipeline-sim.js](file:///c:/projects/finalyear/src/replay/pipeline-sim.js#L52-L53) (as `displayFovX()`)

The last one is properly factored; the first two inline it. If the formula ever changes (e.g., to handle non-uniform scaling or asymmetric projection), you must find and fix all three.

## 5.4 Unused / Dead Code

- [scene.js](file:///c:/projects/finalyear/src/scene.js#L117): `update(_elapsed) {}` — an empty function exported and called from main.js on every frame. It's a no-op stub from a time when the scene had animated elements. It costs a function call per rAF tick for nothing.
- The `chart-note` div in index.html (line 65-66) contains a measurement caveat that is only visible when the user scrolls inside the chart panel. On a fullscreen locked-pointer demo, nobody will ever see it.

## 5.5 Package.json Implies a Node Project but the Test is a Standalone Script

[package.json](file:///c:/projects/finalyear/package.json) has `"type": "module"` and a test script, but the project is fundamentally a static HTML site served by Python. The Node dependency is solely for `three` (as a devDependency for the test) and the test runner. This dual-runtime setup means a developer must have *both* Python and Node installed. The README tells you to run `npm start` (which calls `python serve.py`) — a Node command that launches a Python process. This is the kind of thing that confuses anyone who isn't you.

---

# Summary Table

| Dimension | Severity | Location | Issue |
|---|---|---|---|
| **Smoke & Mirrors** | 🔴 Critical | warp-shader.js, THEORY.md | Linearisation error unmeasured in the live demo; measurement proves only the screen-centre case |
| **Smoke & Mirrors** | 🔴 Critical | main.js L225 | `applyWarpLag` confounds the warp comparison with a 3× lag change |
| **Smoke & Mirrors** | 🟠 High | shooter.js L44-47 | Hit detection tests warp-off against real-time targets, warp-on against lagged — biased |
| **Smoke & Mirrors** | 🟠 High | latency.js L56 | Warp "latency" is just frame interval, not a measurement |
| **Efficiency** | 🟡 Medium | velocity-pass.js L69-76 | Per-mesh separate render call |
| **Efficiency** | 🟡 Medium | lag.js, latency.js, pose-sync.js | `Array.shift()` on ring buffers everywhere |
| **Efficiency** | 🟡 Medium | warp-shader.js L98-109 | 9-tap de-ghost runs even when motion vectors are off |
| **Architecture** | 🟡 Medium | server-main.js, client-main.js | Cloud pipeline reimplements local pipeline with zero shared code |
| **Assumptions** | 🟡 Medium | input.js | Ignores `getCoalescedEvents()`; input rate display is wrong |
| **Assumptions** | 🟡 Medium | main.js composite loop | No detection of 30 Hz displays where warp is useless |
| **Cognitive** | 🟠 High | 4 files | Guard-band constant `0.12` hardcoded in 4 places |
| **Cognitive** | 🟡 Medium | test/test.js | 627-line hand-rolled test runner instead of `node:test` |
