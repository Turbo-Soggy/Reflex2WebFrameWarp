/* ---------------------------------------------------------------------------
   onboarding.js — Guided first-time experience (Phase 3)
   ---------------------------------------------------------------------------
   The biggest single win from the v2 brief: a stranger should run the thesis as
   a controlled A/B experiment ON THEMSELVES, without reading a keybind wall.

   The flow is a tiny state machine, narrated by a non-blocking "coach" card:

     TRACK   "30 FPS · 150 ms of lag — track the target and shoot."   (feel the pain)
       │  after ~5 shots, or a timeout, or an early W press
       ▼
     PRESS_W "Now turn on Frame Warp."  + a big animated W prompt      (the moment)
       │  when warp turns ON
       ▼
     REVEAL  "Same scene. Same target. The only difference is Frame Warp."
       │  after a few hits, or a timeout
       ▼
     DONE    coach hides; the demo is now theirs to explore.

   It listens to the loose `framewarp:shot` / `framewarp:warp` events the shooter
   and controls emit, so it stays fully decoupled from the render loop. Append
   ?nointro to the URL to skip it (handy while developing).
--------------------------------------------------------------------------- */

export function installOnboarding() {
  const coach = document.getElementById('coach');
  const titleEl = coach?.querySelector('.coach-title');
  const bodyEl = coach?.querySelector('.coach-body');
  const promptEl = document.getElementById('coach-prompt');

  // Nothing to drive, or explicitly disabled → a no-op start().
  if (!coach || new URLSearchParams(location.search).has('nointro')) {
    return { start() {} };
  }

  const SHOTS_TO_ADVANCE = 5;   // misses needed before we nudge "press W"
  const HITS_TO_FINISH = 4;     // hits with warp on before we bow out
  const TRACK_TIMEOUT = 16000;  // ms: advance even if they barely shoot
  const REVEAL_TIMEOUT = 9000;  // ms: auto-finish the reveal

  let state = 'idle';
  let started = false;
  let shots = 0;
  let hits = 0;
  let timer = null;

  const clearTimer = () => { clearTimeout(timer); timer = null; };
  function show(title, body) {
    titleEl.textContent = title;
    bodyEl.textContent = body;
    coach.classList.add('show');
  }

  function toTrack() {
    state = 'track'; shots = 0;
    show('30 FPS · 150 ms of lag',
      'Track the moving target and shoot. Notice how your shots land where it just was.');
    clearTimer();
    timer = setTimeout(toPressW, TRACK_TIMEOUT);
  }
  function toPressW() {
    state = 'pressW';
    clearTimer();
    show('Now turn on Frame Warp', 'Same scene, same lag — one key fixes it.');
    promptEl?.classList.add('show'); // giant animated "W"
  }
  function toReveal() {
    state = 'reveal'; hits = 0;
    promptEl?.classList.remove('show');
    show('Same scene. Same target.',
      'The only difference is Frame Warp. Keep tracking — watch the accuracy climb.');
    clearTimer();
    timer = setTimeout(done, REVEAL_TIMEOUT);
  }
  function done() {
    state = 'done';
    clearTimer();
    promptEl?.classList.remove('show');
    coach.classList.remove('show');
  }

  window.addEventListener('framewarp:shot', (e) => {
    if (state === 'track') {
      if (++shots >= SHOTS_TO_ADVANCE) toPressW();
    } else if (state === 'reveal') {
      if (e.detail.hit && ++hits >= HITS_TO_FINISH) done();
    }
  });
  window.addEventListener('framewarp:warp', (e) => {
    // Turning warp on from the early steps jumps straight to the reveal — works
    // whether prompted or done by an impatient expert.
    if (e.detail.on && (state === 'track' || state === 'pressW')) toReveal();
  });

  return {
    start() {
      if (started || state === 'done') return;
      started = true;
      toTrack();
    },
  };
}
