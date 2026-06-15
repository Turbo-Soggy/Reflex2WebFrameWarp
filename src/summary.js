/* ---------------------------------------------------------------------------
   summary.js — Session summary card (Phase 5)
   ---------------------------------------------------------------------------
   When the user releases the mouse (Esc), show a clean, screenshot-ready results
   card: accuracy per mode, the improvement Frame Warp made, and the latency
   condition. This is the artefact an examiner photographs and quotes.

   It reads the persistent scoreboard tallies (full-session, honest) plus the
   measured view-latency readouts. Accuracy is the hero metric because it's the
   real, end-to-end result; the latency line states the condition that produced
   it. Click the card to dive back in.
--------------------------------------------------------------------------- */

export function installSummary(ctx) {
  const el = document.getElementById('summary');
  if (!el) return { show() {}, hide() {} };
  const card = el.querySelector('.summary-card');

  const shots = (b) => b.hits + b.misses;
  const acc = (b) => (shots(b) ? Math.round((b.hits / shots(b)) * 100) : 0);

  function render(d) {
    const offN = shots(d.off), onN = shots(d.on);
    const offAcc = acc(d.off), onAcc = acc(d.on);

    let delta;
    if (offN && onN) {
      const dp = onAcc - offAcc;
      delta = `Frame Warp changed your accuracy by <b>${dp >= 0 ? '+' : ''}${dp} points</b>`;
    } else {
      delta = 'Try <b>both</b> modes (press <kbd>W</kbd>) to see the comparison';
    }

    const measured = (typeof d.latNoWarp === 'number' && typeof d.latWarp === 'number')
      ? ` · measured view latency ≈ ${Math.round(d.latNoWarp)} → ${Math.round(d.latWarp)} ms`
      : '';

    card.innerHTML =
      `<div class="summary-h">Session Summary</div>
       <div class="summary-grid">
         <div class="summary-col off">
           <div class="summary-mode">WITHOUT WARP</div>
           <div class="summary-acc">${offAcc}<span>%</span></div>
           <div class="summary-sub">${d.off.hits}/${offN} hits</div>
         </div>
         <div class="summary-col on">
           <div class="summary-mode">WITH WARP</div>
           <div class="summary-acc">${onAcc}<span>%</span></div>
           <div class="summary-sub">${d.on.hits}/${onN} hits</div>
         </div>
       </div>
       <div class="summary-delta">${delta}</div>
       <div class="summary-foot">Same 30 FPS scene · Frame Warp cut injected lag 150 → 50 ms${measured}</div>
       <div class="summary-cont">click to continue</div>`;
  }

  function show() {
    const d = ctx.getData();
    if (shots(d.off) + shots(d.on) === 0) return; // nothing to summarise yet
    render(d);
    el.classList.add('show');
  }
  function hide() { el.classList.remove('show'); }

  // Clicking the card is a user gesture, so we can re-acquire pointer lock.
  el.addEventListener('click', () => { hide(); ctx.relock(); });

  return { show, hide };
}
