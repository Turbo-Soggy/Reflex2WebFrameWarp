/* ---------------------------------------------------------------------------
   warp-flash.js — Make the W toggle FEEL like an event
   ---------------------------------------------------------------------------
   Phase 2 of the Upgrade Series. Toggling Frame Warp used to be a silent state
   change you had to read off the small HUD. Now it's a moment: a brief
   full-screen colour pulse (cool blue = ON, warm red = OFF) plus a large,
   fading "FRAME WARP ON/OFF" announcement, like a game-mode call-out.

   Pure DOM/CSS — composited above the warped canvas, so it costs the pipeline
   nothing. The render loop never sees it.
--------------------------------------------------------------------------- */

/** Restart a one-shot CSS animation in the right colour state. */
function trigger(el, on) {
  el.classList.remove('show', 'on', 'off');
  void el.offsetWidth; // reflow so the animation re-fires on rapid toggles
  el.classList.add(on ? 'on' : 'off', 'show');
}

export function announceWarp(on) {
  const pulse = document.getElementById('warp-pulse');
  const text = document.getElementById('warp-announce');
  if (text) text.textContent = on ? 'FRAME WARP ON' : 'FRAME WARP OFF';
  if (pulse) trigger(pulse, on);
  if (text) trigger(text, on);
}
