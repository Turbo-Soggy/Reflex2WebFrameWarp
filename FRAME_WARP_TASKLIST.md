# Frame Warp — Research Program Tasklist

> Derived from `RESEARCH_ROADMAP.md`. Same phases, same exit criteria — just made tickable.
>
> **STATUS PASS — June 2026 (project close).** The machine-executable subset
> of every phase was completed in one sitting and committed per phase on
> `cloud-stream`. Boxes are marked honestly: `[x]` done and verified, `[ ]`
> with **SKIPPED/BLOCKED** notes where the work needs hardware, humans, or
> institutional process that doesn't exist at this desk. The roadmap's "resist
> starting with code" warning was respected: Phase 0 ran first.

---

## Phase 0 — Re-validate the landscape (1 week)

*Output: `docs/PHASE0_WHAT_CHANGED.md` — written as a baseline snapshot to
diff against on return.*

- [x] Search whether anyone published browser/client-side cloud-stream reprojection
  - [x] Run searches: client-side reprojection cloud gaming, latency compensation game streaming, asynchronous reprojection streaming — **none found; novelty window open**
  - [x] Check MMSys, NOSSDAV, IEEE VR, SIGGRAPH proceedings — *partial: search API errors blocked some queries; closest find is arXiv 2604.02851 (Gaussian streaming, 2026), which treats image-space video reprojection as its baseline category*
  - [x] Novel claim revised accordingly (memo §4)
- [x] Check what Nvidia/AMD/Valve shipped — **Reflex 2 Frame Warp still unshipped as of June 2026** (announced CES 2025; modder demo only); no streaming reprojection in GeForce NOW / Steam Link found
  - [x] No redirect to evaluation/characterization needed yet
- [x] Check current browser support — rVFC still lacks `captureTime` (empirical, this codebase), WebTransport game streaming appearing in 2025 proceedings, WebGPU mature but a port buys no measurement
- [x] Re-read the codebase cold — *N/A at project close (context still warm); budget the 2–3 days on return*
- [x] **One-page "what changed" memo + revised novelty claim** → `docs/PHASE0_WHAT_CHANGED.md`

---

## Phase 1 — Foundation hardening (3–4 weeks)

- [ ] Port to current tech (WebGPU + WebCodecs) — **SKIPPED, deliberately**: the WebGL2 pipeline loses nothing measurable; a port is plumbing risk with no science gain. Re-decide on return (roadmap decision point 2).
- [ ] Build the hardware ground-truth rig — **BLOCKED: no photodiode/Arduino/high-speed camera at this desk.** First physical task on return; the roadmap's "before any experiment" warning stands.
- [x] Build the deterministic replay system → `src/replay/trace.js`
  - [x] Record input traces (timestamped pose streams) — `T` key in the live demo records + downloads JSON (verified in-browser)
  - [x] Replay them bit-exact through any pipeline configuration — `src/replay/pipeline-sim.js` drives the REAL `LagSim` through the same tick structure as `main.js`
  - [x] Verify: same trace → N configurations → controlled comparison (`bench/adaptive.js` is exactly this)
  - [ ] (Bonus: side-by-side visual replay in the live demo — not built; the headless comparison exists)
- [x] Build headless benchmark mode — `node bench/run.js` (trace or synthetic → CSV, no human; byte-identical across processes, verified by file hash)
- [ ] **File the university IRB/ethics paperwork** — **BLOCKED: institutional process, not executable from here.** Still the first paperwork task on return.

**Exit criteria**
- [x] Replay trace produces identical results across runs — automated test + cross-process hash check
- [ ] Hardware vs software latency delta characterized — **blocked on the rig**

---

## Phase 2 — The theory layer (2–3 weeks, parallel with Phase 1)

*Output: `docs/THEORY.md`, `docs/RELATED_WORK.md`, `docs/references.bib`.*

- [x] Formalize the latency decomposition model (THEORY.md §1)
  - [x] `L_total = L_input + L_uplink + L_render + L_encode + L_downlink + L_decode + L_composite`
  - [x] Rotation-to-photon → `L_composite` only (≤ one display interval)
  - [x] What it cannot remove: interaction-, object-motion-, translation-to-photon
  - [x] Jitter-immunity theorem, with its two honest conditions (guard margin; exact pose recovery) — THEORY.md §2
- [x] Derive the error bound for rotation-only warp
  - [x] Guard exhaustion: Δmax = (g/uScale)·F; onset ω* ∈ [Δmax/(L+T_r+T_d), Δmax/L] — the display-tick term was *found by the instrument* (first draft omitted it; the test caught it)
  - [x] Analytic break points: 130.6–212.2 °/s at default config (measured ~143); linearisation error exact at θ≈±34°; parallax `(W/F)·v⊥·A/d` (analytic only — demo camera never translates)
  - [x] Predicted vs measured: automated (`test/test.js` clamp-onset + linearisation tests); figure-ready CSV via `node bench/run.js --sweep-velocity 60:260:5` *(render the plot when making figures)*
- [x] Related-work survey → `docs/RELATED_WORK.md` (7 clusters, each closed with the gap this project occupies)
  - [x] Outatime, ATW/ASW, cloud-gaming latency studies, frame generation, Phase 0 findings
  - [x] 28 entries in `docs/references.bib` — ⚠ compiled largely from memory: **verify every entry against the publisher before citing**

**Exit criteria**
- [x] Error model predicts measured artifact onset within stated tolerance (automated test)
- [x] Related-work doc exists and positions the claim precisely

---

## Phase 3 — The novel extension (4–6 weeks) — pick ONE

- [x] **Decided: Option C** — correct under the roadmap's own rule ("if time-constrained"); A and B remain open as the bigger swings for the return.

### Option A — Depth-aware streamed reprojection *(not chosen — strongest candidate on return)*
- [ ] Low-res depth buffer over the data channel; parallax-corrected warp; artifact/bandwidth/depth-resolution trade-off

### Option B — Learned pose prediction *(not chosen — needs Phase 4 traces for training data anyway)*
- [ ] Small model vs linear-extrapolation baselines; needs the user-study trace corpus

### Option C — Adaptive guard band ✅ *(done, simulation-level)*
- [x] Margin sized by recent angular-velocity statistics — `src/replay/adaptive-guard.js`, inverting the THEORY.md margin equation
- [x] Bandwidth saved vs clamp-fallback rate — `bench/adaptive.js` + `docs/ADAPTIVE_GUARD.md`: calm input +73% → +9% pixel tax at zero clamps; hot input clamp rate 0.086 → 0
- [x] Scoped honestly: a strong *section*, simulation-level; encoder reaction to mid-stream FOV change must be measured in the live cloud demo before quoting as a systems result

**Exit criteria**
- [x] Beats its baseline on at least one metric with reportable effect size, via replay benchmarks — on every trace; on both metrics for calm input

---

## Phase 4 — The user study (3–4 weeks including analysis)

**BLOCKED in its entirety: requires 24 human participants and IRB approval —
neither is executable by an agent at a desk, and faking it would poison the
one component that converts engineering into research.** Unchanged from the
roadmap; the shooter task, the tracking task, and the trace-collection hook
(`T` key) are already built, so the study can start the day ethics clears.

- [ ] IRB/ethics approval in hand
- [ ] Design: N=24, within-subjects, counterbalanced; {warp} × {40/80/150 ms} × {static/jitter} (+ adaptive-guard condition from Phase 3)
- [ ] Tasks: instrumented target acquisition + tracking (RMS)
- [ ] Measures: hit rate, time-to-acquire, tracking RMS, NASA-TLX
- [ ] Pre-register hypotheses (dated commit)
- [ ] Run sessions; collect input traces (→ Option B training data + replay corpus)
- [ ] Repeated-measures ANOVA, effect sizes (η²), CIs

**Exit criteria**
- [ ] A results table you'd defend to a hostile reviewer

---

## Phase 5 — The paper (3 weeks)

**Deferred: depends on Phase 4.** The raw material that exists now: the
carrying figure's data (README headline table + `--sweep-velocity` CSV), the
Discussion (honest-limitation tables), the Background (codec/motion-vector
analysis), the Methodology (measurement caveats), THEORY.md, RELATED_WORK.md.

- [ ] Check venue deadlines (MMSys → NOSSDAV → IEEE VR → regional IEEE)
- [ ] Assemble from the fragments above
- [ ] Render the carrying figure from recorded CSV (delay on x, perceived rotation latency on y)
- [ ] Release code + traces + study data; pursue artifact badges

---

## Decision points to revisit on return

- [x] Has the novelty window closed? — **No, as of June 2026** (PHASE0 memo; re-run the diff on return)
- [ ] WebGPU/WebCodecs/WebTransport — deferred with rationale (Phase 1 note)
- [x] Option A vs B vs C — C done at simulation level; **A is the strongest next swing** (and turns the parallax error term from THEORY.md §5 into signal)
- [ ] Paper vs portfolio vs PhD application — **Isaac's call, not the toolchain's.** Paper → Phase 4 first; portfolio → live-demo Option C + side-by-side replay; PhD → THEORY.md + a preprint from what exists.

---

## Sequencing reference

```
Phase 0 (1 wk) → Phase 1 (3–4 wk) → Phase 3 (4–6 wk) → Phase 4 (3–4 wk) → Phase 5 (3 wk)
                      ↘ Phase 2 (2–3 wk, parallel) ↗
IRB paperwork: file at Phase 1, needed by Phase 4
Total: ~4 months full-time, ~8–9 months alongside a job
```

## What will NOT have aged (the durable assets — protect these)
- The math: angular reprojection, tangent-exact crop, error geometry — now written down in `docs/THEORY.md` with stated limits
- The measurement discipline: proxy vs ground-truth honesty
- The experimental logic: replay-based controlled comparison — now an actual instrument (`src/replay/`, `bench/`)
- The limitation framing

*The plumbing is disposable; the thinking isn't. Start with Phase 0 — resist starting with code.*
