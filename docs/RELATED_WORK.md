# Related work — positioning the claim

> Phase 2 of the research roadmap. Keys refer to `references.bib`, where
> every entry now carries a STATUS line from the June 2026 provenance pass:
> verified against the publisher/index, found at title level, or inferred
> from memory. Read the paper itself before citing it for a claim.

## The claim being positioned

*A browser-based, client-side rotational-reprojection pipeline for cloud game
streaming over commodity WebRTC video — no server modification beyond a
wider-FOV render, frame-exact pose sync via in-band pixel tags, and perceived
rotation latency provably independent of network delay and jitter.*

Each cluster below ends with the gap this project occupies relative to it.

## 1. Image-based rendering and post-render warping

The mathematical ancestry. View interpolation [chen1993view] and plenoptic
warping [mcmillan1995plenoptic] established synthesising nearby views from
rendered images; *Post-Rendering 3D Warping* [mark1997post] is the direct
ancestor — warp a rendered frame to a newer viewpoint rather than render
again. **Gap:** all assume local access to the renderer's outputs (often
including depth); none address a compressed video stream as the only input.

## 2. VR reprojection

Carmack's latency-mitigation essay [carmack2013latency] introduced timewarp to
consumer VR; ATW [vanwaveren2016atw] made it asynchronous and scheduled; ASW
[oculus2016asw] added extrapolation for object motion. The render-margin
(guard band) and the rotation-only honesty caveats in this project are
directly inherited from this literature. FlashBack [boos2016flashback] and
Furion [lai2017furion] brought reprojection-adjacent techniques to mobile VR
with split rendering. **Gap:** the VR compositor owns the GPU and the engine —
poses, depth, undistorted frames. Here the client owns nothing but decoded
video plus a data channel, and runs in a browser sandbox.

## 3. Cloud gaming: latency measurement

The measurement discipline. [chen2011measuring] measured commercial cloud
gaming latency; [choy2012brewing] showed CDN-style proximity cannot solve it;
[jarschel2011qoe] and [claypool2014latency] quantified the QoE cost;
[claypool2006latency] and [beigbeder2004effects] established the per-genre
latency sensitivity that makes FPS-style camera control the hard case;
[kamarainen2017imperceptible] measured what it takes to reach imperceptible
latency in mobile cloud gaming;
[carrascosa2022stadia] characterised a production service (Stadia). **Gap:**
these measure and decompose; they do not *remove* terms. This project's
decomposition (docs/THEORY.md §1) follows their method, then deletes every
term but the composite for rotation.

## 4. Latency compensation for cloud gaming — the direct competitors

The closest prior art, all **server-side or engine-side**: Outatime
[lee2015outatime] speculates future frames on the server and ships them ahead
of input (needs the game engine, server compute per speculation branch);
Kahawai [cuervo2015kahawai] splits rendering between server and a capable
client GPU running the same engine; [sabet2020latency] adapts game mechanics
to latency rather than reducing it; FPS lag-compensation chapters
[li2018lagcompensation] adjust hit registration, not the displayed view.
**Gap — the core of the novelty claim:** none reproject *the video stream
itself, on the client, without engine access*. The thin client that
[lee2015outatime] explicitly assumes cannot help is here given exactly one
capability — a UV remap of the decoded frame — and that turns out to be
enough for the rotation term.

## 5. Frame generation and industry warp

DLSS 3 [nvidia2022dlss3] and FSR 3 [amd2023fsr3] interpolate/extrapolate
frames locally using engine motion vectors — the same family as this
project's motion-vector layer, and the same reason it is *excluded* from the
cloud demo (no velocity channel survives video encoding; README capability
table). Reflex 2 Frame Warp [nvidia2025reflex2] is the closest industrial
statement of the thesis — warp the latest frame to the freshest input — but
is local-GPU, proprietary, and as of June 2026 unshipped. **Gap:** no
streaming variant exists publicly; this project is the streaming +
open + browser instantiation, with measurements.

## 6. Transport

WebRTC [rfc8825] is the only browser path to sub-second interactive video
today; WebTransport-based game streaming is emerging
[nguyen2025webtransport] and is the natural successor for the control
channel (the architecture transfers; only the plumbing changes — roadmap
Phase 1 note). **Gap:** transport work optimises delivery latency; it cannot
remove the latency already accumulated — reprojection composes with any of it.

## 7. Closest contemporary work

*Streaming Real-Time Rendered Scenes as 3D Gaussians*
[siekkinen2026gaussian] replaces the 2D video representation entirely so the
client can re-render views — explicitly motivated by the limits of
"image-space reprojection of 2D video," which it treats as the baseline
category. **Gap/complement:** it abandons commodity video codecs and players;
this project stays inside them. If Gaussian streaming matures, this project
becomes the *commodity-infrastructure baseline* such systems must beat — a
position worth measuring well, which is what the replay instrument is for.
(Lineage note from the provenance pass: its authors are the same
Siekkinen/Kämäräinen group behind the imperceptible-latency measurement study
[kamarainen2017imperceptible] — the measurement people moved to
representation; nobody took the commodity-video warp path.)

## Citation count

28 entries in `references.bib` (target was 25–30): 3 IBR ancestry, 5 VR
reprojection, 10 cloud-gaming systems & measurement, 4 latency compensation,
3 frame generation/industry, 2 transport (incl. the WebRTC RFC), 1
contemporary.
