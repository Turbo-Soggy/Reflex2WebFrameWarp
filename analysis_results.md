# Frame Warp — Making the Demo Unforgettable

After a deep read of every source file, your README, tasklist, and research roadmap, here's my honest assessment: **the engineering is already exceptional** — two-clock architecture, honest hit detection, guard-band math, motion vectors, cloud streaming, replay benchmarks, adaptive guard band, formal theory. What you're missing isn't depth — it's **showmanship**. The gap between "technically brilliant" and "unforgettable demo" is mostly presentation, pacing, and a few high-impact features that make the judge *feel* the difference before they understand it.

Below are recommendations grouped by effort and impact. I've separated "things that would genuinely elevate the demo" from "nice-to-haves" so you can triage.

---

## 1. Guided Demo Mode — The Single Biggest Win

**Problem:** Right now, someone walks up to your demo and sees a shooting range, a wall of stats, and a bunch of keyboard shortcuts. They don't know what they're looking at or what to do. The "click to enter" overlay lists 8 keybinds — that's an engineering interface, not a demo.

**Fix: A scripted "first-time experience" that tells the story for you.**

### A) Onboarding Walkthrough (High Impact, ~2-3 hours)
- Replace the overlay with a **3-step cinematic intro**:
  1. **"This scene runs at 30 FPS with 150ms of lag. Try tracking the target."** (warp off, let them feel the pain for 5-10 shots)
  2. After N misses or a timer: **"Now press W."** Giant animated prompt. The lag drops, the warp kicks in. Let them feel the snap.
  3. **"Same 30 FPS scene. Same target. The only difference is Frame Warp."** Show the before/after accuracy as a big reveal card.
- This turns a "poke around and figure it out" into a **controlled A/B experiment the user runs on themselves**. That's the thesis in 30 seconds.

### B) Auto-Demo / Attract Mode (Medium Impact, ~3-4 hours)
- When idle (no pointer lock for 30+ seconds), run a **looping attract mode**:
  - Camera slowly pans, showing the range
  - Alternates between warp-off (stuttery, laggy aim overlay) and warp-on (smooth)
  - Latency chart animates in real time
  - Text overlays explain what's happening
- This is what catches someone walking past your booth at a poster session or expo.

---

## 2. Visual Polish — Make It Look Like a Product, Not a Lab

### A) Scene Upgrades (Medium Impact, ~2-4 hours)
Your scene is functional but reads as "Three.js tutorial." For a demo that competes for attention:
- **Particle system on hit** — sparks / ring burst when you hit the bullseye (you already have the hit event; add a short-lived `THREE.Points` burst)
- **Muzzle flash + screen shake** — a 2-frame white overlay + tiny camera jolt on fire. Sells the "shooting" metaphor and makes the feedback loop feel alive
- **Animated target reactions** — hit targets could shatter, spin, or flash rather than just the ✓ overlay. Physical feedback > text feedback
- **Ambient particles** — dust motes floating in the strip lights. Costs almost nothing, makes the scene feel like a real space instead of a box
- **Better bullseye** — your canvas-baked texture is 128px. A 512px version with a subtle glow ring and a 3D beveled disc (extruded cylinder) would look dramatically better

### B) UI/HUD Overhaul (High Impact, ~2-3 hours)
- **Animated state transition on W press** — when warp toggles, flash a brief full-screen vignette or color pulse (blue for warp-on, red for warp-off). Make the toggle *feel* like an event, not a silent state change
- **Big floating "WARP: ON/OFF" indicator** — centered, fading, like a game mode announcement. Right now you have to read the small HUD text
- **Redesign the overlay card** with a gradient background, subtle animation, and a hero illustration or icon. The current `<h1>Frame Warp</h1>` with a `<p>` doesn't sell anything
- **Scoreboard polish** — animate accuracy changes (count-up effect), pulse the number on change, add a subtle bar chart behind the percentage

### C) Sound Design (High Impact, ~1-2 hours)
This is the most underrated demo trick. Your entire experience is silent:
- **Gunshot click sound** — a short, punchy audio sample on fire (Web Audio API, ~10 lines)
- **Hit confirmation sound** — a satisfying "ding" or metallic ping
- **Miss sound** — a dull thud or ricochet
- **Ambient range hum** — low-frequency background audio
- **Warp toggle sound** — a "click-on" / "power-down" sound effect

Sound makes the difference between "I'm clicking in a browser" and "I'm in a shooting range." The audio feedback also reinforces hit/miss without the user reading text.

> [!TIP]
> You can use royalty-free sfx from freesound.org or generate them procedurally with the Web Audio API (oscillator → gain envelope). The procedural route means no downloads and works offline — consistent with your vendored-Three.js philosophy.

---

## 3. Wow-Factor Features (Pick 1-2)

### A) Side-by-Side Split-Screen Comparison (High Impact, ~3-4 hours)
You had this and collapsed it into single-screen. **Bring it back as a toggleable comparison mode** (`C` key or a button):
- Left half: warp OFF (the problem)
- Right half: warp ON (the solution)
- **Same input drives both** simultaneously
- Divider line with labels
- Both scoreboards visible

This is the single most convincing visual for a judge or examiner. They see the *same mouse input* producing two different outcomes **at the same time**. No toggling, no memory. The contrast is immediate and undeniable.

### B) Slow-Motion Replay of Last Shot (Medium Impact, ~4-5 hours)
After each shot, optionally show a **0.25x replay** in a picture-in-picture window:
- The crosshair path over the last 500ms
- Where the target was at the moment of the click
- Where the ray actually went (with vs without warp)
- Traces the angular error as a visual arc

This turns an abstract concept (latency compensation) into something a non-technical person can **see**. "Look — the ray was aimed *here*, but the screen was showing *there*."

### C) Live Heat Map of Where You're Actually Aiming vs. Where the Screen Shows (Medium Impact, ~3 hours)
- A small overlay showing the real cursor position (green dot) vs. the displayed position (red dot)
- Trail behind each showing the divergence over time
- The gap between them IS the latency. Warp collapses the gap to zero
- This is a **real-time visualization of the thesis statement**

### D) "Feel the Lag" Progressive Demo (Low Effort, ~1 hour)
- A mode that **ramps lag from 0 to 250ms over 30 seconds** while you try to track
- The gradual degradation is viscerally uncomfortable
- Then snap warp on → instant relief
- Examiners who've never thought about MtP latency will *understand it in their body*

---

## 4. Data & Visualization Upgrades

### A) Real-Time Accuracy Graph (Medium Impact, ~2 hours)
Next to the latency chart, add a **rolling accuracy chart**:
- X axis: time
- Y axis: hit rate (rolling window of last 20 shots)
- Two lines: warp-on accuracy, warp-off accuracy
- This tells the story quantitatively in real time, not just at the end

### B) Session Summary Card (Medium Impact, ~1-2 hours)
When the user presses `Esc` after a session (or after N shots), show a **results card**:
- Total shots per mode, accuracy per mode
- Average latency per mode
- A delta summary: "Frame Warp improved your tracking accuracy by **47%** and reduced perceived latency by **83ms**"
- Optionally shareable (screenshot-able layout, or copy-to-clipboard)
- This is what the examiner photographs and puts in their notes

### C) Latency Chart Improvements (Low Effort, ~1 hour)
- Add a **vertical dashed line** when `W` is toggled, so the chart shows exactly when the mode changed
- Add **mean/p95 annotations** on each line (inline text labels)
- Make the chart resizable or full-screenable for the report figures

---

## 5. Robustness & Accessibility

### A) Mobile/Touch Fallback (Low Priority unless presenting on varied hardware)
- Detect touch devices and show a clean "Desktop required" page with an embedded video of the demo instead of a broken canvas

### B) Performance Tier Detection (Low Effort, ~30 min)
- On load, measure the actual display rate and warn if it's ≤30 Hz (you already do this after 90 frames — make it a visible banner, not just a console.warn)
- Suggest disabling battery saver / enabling high-performance GPU

### C) Keyboard Shortcut Cheat Sheet (Low Effort, ~30 min)
- A toggleable `?` overlay showing all keys, styled like a game control reference
- Much better than listing them in the click-to-start card

---

## 6. Academic Credibility Boosts

### A) "About" Panel with the Theory (Medium Impact, ~1-2 hours)
- An expandable panel (or a `?` / `i` button) that shows:
  - The core equation: `sampleUV = uGuard + (vUv + uDelta) × uScale`
  - The latency decomposition diagram from THEORY.md
  - A link to your related work
- This turns the demo from "cool game" to "this person understands the math." Examiners love seeing the theory embedded in the artefact

### B) Configuration Permalink (Low Effort, ~30 min)
- Encode the current slider state (lag, Hz, guard) into the URL hash
- `http://localhost:8000/#lag=120&hz=20&guard=18`
- Makes it trivial to share specific configurations in your report or with examiners

### C) Automated A/B Test Mode (Medium Impact, ~2-3 hours)
- A button that runs a structured test: 20 shots warp-off, 20 shots warp-on (randomized order), then shows a results card
- This is a **mini user study** that any examiner can run on themselves
- Produces data in the exact format your Phase 4 study would use
- Demonstrates that you've thought about experimental methodology even without IRB access

---

## Priority Ranking (If You Can Only Do 3)

| Priority | Feature | Why |
|---|---|---|
| 🥇 | **Guided onboarding walkthrough** (§1A) | Transforms "confusing tech demo" into "self-running story." Examiners who don't understand the domain will understand YOUR demo |
| 🥈 | **Sound design** (§2C) | Absurd ROI — 1-2 hours of work turns a silent browser page into an immersive experience. The #1 thing that separates "student project" from "product" |
| 🥉 | **Side-by-side comparison mode** (§3A) | The single most convincing visualization. No explanation needed — the judge sees two views, same input, different outcomes |

### Honorable mentions
- Session summary card (§4B) — gives the examiner something concrete to photograph/quote
- Animated warp toggle feedback (§2B) — small change, big "feel" improvement
- "Feel the lag" ramp mode (§3D) — visceral and takes ~1 hour

---

## What NOT to Do

- ❌ Don't add more technical features (you have plenty — the problem isn't depth)
- ❌ Don't port to WebGPU (you said this yourself — plumbing risk, no science gain)
- ❌ Don't build a backend / login system / leaderboard (scope creep)
- ❌ Don't add more targets or game mechanics (the single-target tracking is the scientifically correct design)
- ❌ Don't redesign the shooting range into a "cool game environment" (the sterile range is honest — it says "this is a controlled experiment," which is what you want academically)

---

> [!IMPORTANT]
> The project's technical foundation is genuinely strong — the two-clock architecture, the honest hit detection, the guard-band math, the measurement caveats in the README. What's missing is the **5 minutes of first-impression polish** that makes someone *want* to engage with all that depth. The features above are ordered to maximize that first impression per hour of work.
