# Frame Warp → Research Program
## A Long-Horizon Implementation Plan

> **Written:** June 2026, at the close of the final-year project.
> **Intended reader:** Isaac, 2-5 years from now.
> **Premise:** The local demo and (possibly) the cloud stream reprojection exist. This document is the path from "strong project" to "publishable research program," written to survive the gap between now and whenever you pick it back up.

---

## 0. Before anything else: re-validate the landscape

This field moves. Before writing a line of code, spend one week answering:

- **Did anyone publish browser/client-side cloud-stream reprojection?** Search: "client-side reprojection cloud gaming," "latency compensation game streaming," "asynchronous reprojection streaming." Check MMSys, NOSSDAV, IEEE VR, SIGGRAPH proceedings since 2026. If someone did it — your novel claim shifts to whatever they didn't do (depth-aware, learned prediction, jitter analysis). Do not skip this; building a "world first" that's three years late is the classic returning-researcher mistake.
- **What did Nvidia/AMD/Valve ship since 2026?** Reflex 2 evolution, anything reprojection-adjacent in GeForce NOW or Steam Link. Industry shipping it doesn't kill the research — it kills the *novelty framing* and redirects you toward evaluation/characterization instead.
- **What does the browser support now?** WebGPU will have matured. WebCodecs may give per-frame metadata natively (which would delete your entire Plan A/Plan B frame-sync problem). WebTransport may have replaced your DataChannel approach. The 2026 plumbing choices are probably obsolete — the architecture isn't.
- **Re-read the codebase cold.** The READMEs and inline comments were written to teach. Budget 2-3 days to rebuild mental state. The honest-limitation tables in the README are your fastest re-entry point.

**Output of Phase 0:** a one-page "what changed" memo and a revised novelty claim. Everything below adjusts to it.

---

## Phase 1 — Foundation hardening (3-4 weeks)

Goal: turn the demo codebase into a research instrument you can trust.

1. **Port to current tech.** Likely WebGPU + WebCodecs by now. The shader math (angular delta, tangent-exact guard band, neighborhood clamp) transfers unchanged; the plumbing rewrites. Treat this as the re-learning exercise.
2. **Hardware ground-truth rig.** Photodiode + Arduino (or 240fps+ camera): physical input event → photon change. ~20 measurements per condition, one calibration table. Every software-measured number in the eventual paper inherits credibility from this. *Do this before any experiment — retrofitting credibility doesn't work.*
3. **Deterministic replay system.** Record input traces (timestamped pose streams), replay them bit-exact through any pipeline configuration. This is the backbone of every experiment that follows: same input trace, N configurations, perfectly controlled comparison. Also your demo killer-feature (side-by-side replay).
4. **Headless benchmark mode.** Run a replay trace through a configuration and emit a CSV without a human present. You will run thousands of these.

**Exit criteria:** replay trace → identical results across runs; hardware vs software latency delta characterized and documented.

---

## Phase 2 — The theory layer (2-3 weeks, parallel with Phase 1)

Goal: claims become statements with stated limits.

1. **Latency decomposition model.** Formalize: `L_total = L_input + L_uplink + L_render + L_encode + L_downlink + L_decode + L_composite`. Prove which terms rotation-reprojection removes (rotation-to-photon → `L_composite` only) and which it cannot (interaction-to-photon, object-motion-to-photon). The jitter-immunity observation becomes a theorem: perceived rotation latency is independent of frame-age variance because the delta is computed per-displayed-frame.
2. **Error bound for rotation-only warp.** Reprojection error as a function of: angular velocity, frame age, scene depth distribution (parallax error), guard-band size. Find the analytic point where the approximation breaks (deg/sec at which guard band exhausts; depth ratio at which parallax error exceeds N pixels). Plot predicted vs measured error using the replay system — theory validated by your own instrument.
3. **Write the related-work survey now.** Outatime (Lee et al., MobiSys 2015), Oculus ATW/ASW technical literature, cloud gaming latency studies (Choy et al., Clark et al., Chen et al.), frame generation (DLSS-G, FSR frame gen papers/whitepapers), plus whatever Phase 0 found. Target ~25-30 citations in a living BibTeX file.

**Exit criteria:** error model predicts measured artifact onset within stated tolerance; related-work doc exists and positions your claim precisely.

---

## Phase 3 — The novel extension (4-6 weeks) — pick ONE

The reimplementation + measurement gets to "credible." One of these makes it "novel." Decide based on Phase 0 findings:

### Option A — Depth-aware streamed reprojection *(strongest systems claim)*
Server transmits a low-resolution depth buffer (even 32×18, quantized, ~2KB/frame over the data channel). Client warp becomes parallax-corrected per-pixel reprojection instead of pure rotation. Evaluate: artifact rate vs bandwidth vs depth resolution — a genuine three-way trade-off nobody has published for browser streaming (verify in Phase 0).
- Risk: depth-buffer sync inherits all the frame-sync pain; budget accordingly.
- Fallback position: even *failed* depth streaming with a rigorous analysis of why is a workshop paper.

### Option B — Learned pose prediction *(best AI-degree fit)*
Small model (GRU/tiny transformer, or even gradient-boosted regression) predicting pose 30-80ms ahead from input history. Baseline: linear extrapolation, dead reckoning. Metrics: angular prediction error distribution, overshoot on direction reversals, downstream hit-rate effect via replay system. Train on traces collected from the user study (Phase 4) — the phases feed each other.
- Risk: ML reviewers will ask why not a bigger model; systems reviewers will ask why ML at all. Answer both in writing before building.

### Option C — Adaptive guard band *(smallest, cleanest)*
Margin sized by recent angular-velocity statistics. Evaluate bandwidth saved vs clamp-fallback rate. Honest scope: this is a strong *section*, not a paper spine. Choose only if time-constrained.

**Exit criteria:** the extension beats its baseline on at least one metric with effect size worth reporting, measured via replay benchmarks.

---

## Phase 4 — The user study (3-4 weeks including analysis)

The single component that converts engineering into research. Non-negotiable for the 10/10.

- **Design:** N=24, within-subjects, fully counterbalanced. Factorial: {warp on/off} × {latency: 40/80/150ms} × {static/jitter}. If Phase 3 shipped, add its condition.
- **Tasks:** target acquisition (your shooter, instrumented) + a tracking task (follow a moving target, measure RMS error).
- **Measures:** hit rate, time-to-acquire, tracking RMS, plus subjective (NASA-TLX or SSQ if any VR component).
- **Analysis:** repeated-measures ANOVA, report effect sizes (η²) and CIs, not just p-values. Pre-register hypotheses (a dated commit in the repo is fine).
- **Ethics:** university IRB/ethics approval — start the paperwork at Phase 1, it's slow.
- Collect input traces from every session → training/eval data for Option B, replay corpus for everything.

**Exit criteria:** a results table with statistics you'd defend to a hostile reviewer.

---

## Phase 5 — The paper (3 weeks)

- **Venue ladder:** ACM MMSys (systems+streaming+measurement — best shape-fit) → NOSSDAV (workshop, friendlier) → IEEE VR (if any XR component) → regional IEEE as floor. Check current deadlines in Phase 0.
- **Structure is already written in fragments:** the honest-limitation tables → Discussion; the codec/motion-vector analysis → Background; the measurement caveats → Methodology. The 2026 conversations contain half this paper.
- **The figure that carries it:** x = injected network delay, y = perceived rotation latency; no-warp line rises linearly, warp line flat. Everything else supports that figure.
- Release the code + replay traces + study data (anonymized) publicly. Artifact evaluation badges materially help acceptance at systems venues.

---

## Sequencing summary

```
Phase 0 (1 wk)  →  Phase 1 (3-4 wk)  →  Phase 3 (4-6 wk)  →  Phase 4 (3-4 wk)  →  Phase 5 (3 wk)
                        ↘ Phase 2 (2-3 wk, parallel) ↗
IRB paperwork: file at Phase 1, needed by Phase 4
Total: ~4 months full-time, ~8-9 months alongside a job
```

## Decision points to revisit on return

1. Has the novelty window closed? (Phase 0 determines everything)
2. WebGPU/WebCodecs/WebTransport: which 2026 plumbing survives?
3. Option A vs B vs C — choose by what the field hasn't done AND what your situation rewards (A for systems roles/PhD applications, B for ML roles)
4. Is the goal a paper, a portfolio piece, or a PhD application artifact? The plan flexes: paper needs Phase 4 most; portfolio needs Phase 3 + a stunning demo; PhD application needs Phase 2 + a strong preprint.

## What will NOT have aged

The math (angular reprojection, tangent-exact crop, error geometry), the measurement discipline (proxy vs ground truth honesty), the experimental logic (replay-based controlled comparison), and the limitation framing. These are the durable assets. The plumbing is disposable; the thinking isn't.

---

*Keep this file in the repo root. Future you: start with Phase 0, resist starting with code.*
