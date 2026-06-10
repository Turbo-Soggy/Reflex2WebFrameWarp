# Phase 0 — "What changed" memo (baseline pass, June 2026)

> The roadmap's Phase 0 assumes this check runs after a multi-year gap. This
> pass ran at project close instead, so it doubles as the **baseline snapshot**:
> when the project is picked back up, re-run the same searches and diff against
> this memo. One page, as specified.

## 1. Has anyone published browser/client-side cloud-stream reprojection?

**Not found.** Searches for client-side reprojection in cloud gaming and
asynchronous reprojection over streaming turned up:

- The cloud-gaming latency-compensation literature remains **server-side or
  game-adaptation focused**: lag compensation for FPS in cloud gaming
  (GamingAnywhere/OnLive user studies), latency compensation via game
  characteristics (MMSys 2020), dead-reckoning/sticky-targets style techniques.
  None reproject the *video stream* on the client.
- **Closest new work:** *Streaming Real-Time Rendered Scenes as 3D Gaussians*
  (arXiv 2604.02851, 2026). Notably, it treats "2D video stream + image-space
  reprojection/warping for latency compensation" as the **baseline category it
  improves on** — confirmation that image-space warp is the standard
  comparator, attacked via a different representation (Gaussians), not via a
  browser/WebRTC video pipeline. ⚠ Abstract-level read only (fetch failed);
  read in full before quoting in a paper.
- Outatime (MobiSys 2015) remains the canonical speculative-execution
  ancestor: server-side prediction, not client-side warp, not browser.

**Novelty window: still open** for the specific claim (browser, commodity
WebRTC video, client-side warp, no proprietary server changes).

## 2. What did industry ship?

- **NVIDIA Reflex 2 Frame Warp**: announced CES 2025 for THE FINALS and
  VALORANT; as of these searches it is **still "coming soon" — not rolled out
  in shipping games**. An unofficial modder demo exists (works back to RTX 20).
  It is a *local-GPU* latency technique, not a streaming one.
- **No evidence found** of GeForce NOW or Steam Link shipping client-side
  reprojection. (Valve's VR compositor reprojection is local, as before.)

Consequence: the novelty framing survives; no redirect to pure
evaluation/characterization needed yet.

## 3. Browser plumbing status

- **Empirical, from this codebase (Chromium, June 2026):**
  `requestVideoFrameCallback` provides `receiveTime` and `rtpTimestamp` but
  **not `captureTime`** — per-frame metadata still cannot identify frames
  exactly, so the pixel frame-tag remains necessary (and remains the measured
  justification for tag-primary design: Plan A ≈99.5% calm / ≈95% jitter).
- **WebTransport**: real game-streaming systems built on it are now appearing
  in proceedings (e.g. a WebTransport-based real-time game streaming system,
  ICCVCI 2025). It is the natural successor to the DataChannel for the control
  channel; the architecture transfers unchanged.
- **WebGPU**: mature in Chromium, but the WebGL2 pipeline here loses nothing
  measurable — a port is plumbing, not science. Defer until a Phase 3 option
  needs compute (e.g. depth-aware warp at scale).
- ⚠ Several searches (detailed caniuse-level status, Safari WebTransport) were
  blocked by API errors during this pass — re-verify on return.

## 4. Revised novelty claim (v2026-06)

> **A browser-based, client-side rotational-reprojection pipeline for cloud
> game streaming over commodity WebRTC video — requiring no server
> modification beyond a wider-FOV render, with frame-exact pose
> synchronisation via in-band pixel tags, and perceived rotation latency that
> is measured (and provable) to be independent of both network delay and
> jitter.**

Distinct from: Reflex 2 (local GPU, unshipped), VR ATW/ASW (local compositor,
no network), Outatime (server-side speculation), Gaussian streaming (replaces
the video representation rather than warping it).

## Sources

- https://www.researchgate.net/publication/325353977_Lag_Compensation_for_First-Person_Shooter_Games_in_Cloud_Gaming
- https://dl.acm.org/doi/abs/10.1145/3339825.3391855
- https://www.researchgate.net/publication/221573811_Measuring_the_latency_of_cloud_gaming_systems
- https://arxiv.org/html/2604.02851
- https://en.wikipedia.org/wiki/Asynchronous_reprojection
- https://www.nvidia.com/en-us/geforce/news/reflex-2-even-lower-latency-gameplay-with-frame-warp/
- https://www.techpowerup.com/330822/nvidia-reflex-2-with-new-frame-warp-technology-reduces-latency-in-games-by-up-to-75-coming-to-the-finals-and-valorant
- https://videocardz.com/newz/puredark-releases-free-demo-of-nvidia-reflex-2-frame-warp-works-on-rtx-20-gpus
- https://dl.acm.org/doi/10.1145/3744725.3744726
