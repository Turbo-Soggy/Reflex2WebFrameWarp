# assets/

Drop-in media for the demo.

## `frame-warp-demo.mp4` (optional)

Shown on the **touch / mobile fallback page** (§5A) — when someone opens the
demo on a phone or tablet, where the mouse-driven interaction can't work, they
get a "use a desktop" page with this clip embedded instead of an inert canvas.

- **What to capture:** ~10–15 s of the live demo showing the before/after —
  track the moving target with Frame Warp **off** (shots miss), then press `W`
  and watch them land. The split-screen A/B replay (`B`) also makes a great clip.
- **Format:** MP4 (H.264), 16:9, muted (it autoplays + loops, muted, inline).
- **Path:** `assets/frame-warp-demo.mp4` (referenced by `#fallback-video` in
  `index.html`). If the file is absent the page degrades cleanly to a placeholder.

Capture with the OS recorder, OBS, or Chrome DevTools, then export to MP4.
