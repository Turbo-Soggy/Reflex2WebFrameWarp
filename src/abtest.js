/* ---------------------------------------------------------------------------
   abtest.js — Automated A/B test + recorded split-screen replay (§3A/§3B/§6C)
   ---------------------------------------------------------------------------
   A mini within-subject user study anyone can run on themselves, then watch
   played back. Press B:

     1) WARP OFF block — take N shots while tracking (you'll miss the moving ones).
     2) WARP ON  block — take N shots (you'll hit).
     3) REPLAY — a side-by-side, slow-motion playback built from the RECORDED
        shots: on the left, a warp-off shot that looked dead-on but missed; on
        the right, a warp-on shot that hit. Same input, same target, opposite
        outcome — the split screen the brief asked for, without ever splitting
        the live render (it replays recorded geometry, not a second viewport).

   Each shot is recorded from the shooter's enriched `framewarp:shot` event:
   where the target LOOKED (displayed/lagged) vs where it really WAS (true), as
   NDC offsets in the crosshair frame. The replay just animates those two facts.
   The recording is exportable as JSON. Pure DOM + Canvas 2D — no THREE, no
   touch to the render loop.
--------------------------------------------------------------------------- */

const SHOTS_PER_BLOCK = 8;
const REPLAY_MS = 2600;  // slow-mo duration of one playback pass
const HOLD_MS = 1100;    // pause on the reveal before looping
const OFF = '#ff7a5c';
const ON = '#4cc2ff';

export function installABTest(ctx) {
  const { setWarp, getWarpEnabled, relock } = ctx;
  const banner = document.getElementById('ab-banner');
  const overlay = document.getElementById('ab-replay');
  const result = document.getElementById('ab-result');
  const offCanvas = document.getElementById('ab-canvas-off');
  const onCanvas = document.getElementById('ab-canvas-on');
  if (!banner || !overlay || !result || !offCanvas || !onCanvas) {
    return { toggle() {}, isActive: () => false };
  }
  const offCtx = offCanvas.getContext('2d');
  const onCtx = onCanvas.getContext('2d');

  let phase = 'idle';            // idle | off | on | replay
  let offCount = 0, onCount = 0;
  let raf = 0, replayStart = 0;
  const shots = [];              // { mode, hit, displayed:{x,y}, actual:{x,y}, errDeg }
  const pick = { off: null, on: null };

  const active = () => phase === 'off' || phase === 'on';
  const showBanner = (t) => { banner.textContent = t; banner.classList.add('show'); };
  const hideBanner = () => banner.classList.remove('show');
  const block = (label, n) =>
    `A/B TEST · WARP ${label} — track & shoot  (${n}/${SHOTS_PER_BLOCK})`;

  function start() {
    phase = 'off'; offCount = 0; onCount = 0; shots.length = 0;
    setWarp(false);                 // run the OFF block first
    showBanner(block('OFF', 0));
    console.log('[FrameWarp] A/B test STARTED');
  }

  function cancel() {
    phase = 'idle';
    cancelAnimationFrame(raf);
    hideBanner();
    overlay.classList.remove('show');
    console.log('[FrameWarp] A/B test CLOSED');
  }

  function onShot(e) {
    if (!active()) return;
    const d = e.detail || {};
    const a = d.aim || { displayed: { x: 0, y: 0 }, actual: { x: 0, y: 0 }, errDeg: 0 };
    // Record by the ACTUAL warp state when fired, so the data stays honest even
    // if the player toggles W against the prompt.
    shots.push({ mode: d.warpOn ? 'on' : 'off', hit: !!d.hit, ...a });

    if (phase === 'off') {
      if (++offCount >= SHOTS_PER_BLOCK) {
        phase = 'on';
        setWarp(true);
        showBanner(block('ON', 0));
      } else {
        showBanner(block('OFF', offCount));
      }
    } else if (++onCount >= SHOTS_PER_BLOCK) {
      finish();
    } else {
      showBanner(block('ON', onCount));
    }
  }

  function accuracy(mode) {
    const a = shots.filter((s) => s.mode === mode);
    return a.length ? Math.round((100 * a.filter((s) => s.hit).length) / a.length) : 0;
  }

  // Best = lowest key. Left wants a well-tracked miss (small displayed offset:
  // "looked on-target"); right wants a clean hit (small actual offset).
  const best = (arr, key) =>
    arr.length ? arr.reduce((b, s) => (key(s) < key(b) ? s : b)) : null;
  const mag = (p) => Math.hypot(p.x, p.y);

  function pickShots() {
    const offs = shots.filter((s) => s.mode === 'off');
    const ons = shots.filter((s) => s.mode === 'on');
    pick.off = best(offs.filter((s) => !s.hit), (s) => mag(s.displayed)) || best(offs, (s) => mag(s.displayed));
    pick.on = best(ons.filter((s) => s.hit), (s) => mag(s.actual)) || best(ons, (s) => mag(s.actual));
  }

  function finish() {
    phase = 'replay';
    hideBanner();
    pickShots();
    result.innerHTML =
      `WITHOUT WARP <b class="off">${accuracy('off')}%</b>` +
      `<span class="ab-sep">vs</span>` +
      `WITH WARP <b class="on">${accuracy('on')}%</b>`;
    document.exitPointerLock?.();   // free the cursor for the replay controls
    overlay.classList.add('show');
    replayStart = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    console.log('[FrameWarp] A/B test COMPLETE — replay');
  }

  function loop(now) {
    if (phase !== 'replay') return;
    const p = Math.min(1, ((now - replayStart) % (REPLAY_MS + HOLD_MS)) / REPLAY_MS);
    drawShot(offCtx, offCanvas, pick.off, p, 'off');
    drawShot(onCtx, onCanvas, pick.on, p, 'on');
    raf = requestAnimationFrame(loop);
  }

  // --- Recording export ------------------------------------------------------
  function download() {
    const data = {
      version: 1, kind: 'framewarp-abtest', createdAt: new Date().toISOString(),
      shotsPerBlock: SHOTS_PER_BLOCK,
      accuracy: { off: accuracy('off'), on: accuracy('on') },
      shots,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `framewarp-abtest-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // --- Wiring ----------------------------------------------------------------
  window.addEventListener('framewarp:shot', onShot);
  document.getElementById('ab-replay-btn')?.addEventListener('click', () => { replayStart = performance.now(); });
  document.getElementById('ab-save-btn')?.addEventListener('click', download);
  document.getElementById('ab-close-btn')?.addEventListener('click', () => { cancel(); relock?.(); });

  return {
    toggle() { (phase === 'idle') ? start() : cancel(); },
    isActive: () => phase !== 'idle',
  };
}

/* --------------------------------------------------------------------------
   Replay drawing — a clean schematic of one recorded shot, in two beats:
     beat 1 (p < 0.5): "what you saw" — the target you tracked, under your aim.
     beat 2 (p ≥ 0.5): "where it really was" — the true target fades in at its
                       offset, with the gap line and the verdict.
   For a warp-off near-miss the gap is wide ("looked dead-on, missed by N°");
   for a warp-on hit the true target sits on the crosshair ("clean hit").
-------------------------------------------------------------------------- */
function drawShot(g, canvas, shot, p, mode) {
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const color = mode === 'on' ? ON : OFF;

  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.02)';
  g.fillRect(0, 0, W, H);

  if (!shot) {
    g.fillStyle = '#8b97a7';
    g.font = '12px ui-monospace, monospace';
    g.textAlign = 'center';
    g.fillText('no qualifying shot', cx, cy);
    return;
  }

  // NDC → px: a few % of the FOV should read as a clear, visible offset.
  const S = (W / 2 - 24) / 0.26;
  const clampPx = (v) => Math.max(-(W / 2 - 14), Math.min(W / 2 - 14, v));
  const mapX = (x) => cx + clampPx(x * S);
  const mapY = (y) => cy - clampPx(y * S);

  // Your aim — the fixed crosshair at centre.
  drawCross(g, cx, cy);

  // Beat 1: the target you tracked, easing into the displayed spot.
  const t1 = Math.min(1, p / 0.5);
  const ease = 1 - Math.pow(1 - t1, 3);
  const seenX = mapX(shot.displayed.x) - (1 - ease) * (W * 0.45);
  const seenY = mapY(shot.displayed.y);
  drawTarget(g, seenX, seenY, color, 0.45);

  // Fire flash around the halfway point.
  if (p > 0.46 && p < 0.62) {
    const f = 1 - Math.abs(p - 0.54) / 0.08;
    g.strokeStyle = `rgba(255,255,255,${0.7 * f})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, 10 + (1 - f) * 22, 0, Math.PI * 2);
    g.stroke();
  }

  // Beat 2: reveal where the target really was.
  if (p >= 0.5) {
    const t2 = Math.min(1, (p - 0.5) / 0.5);
    const rx = mapX(shot.actual.x), ry = mapY(shot.actual.y);
    g.globalAlpha = t2;
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.setLineDash([4, 4]);
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(rx, ry); g.stroke();
    g.setLineDash([]);
    drawTarget(g, rx, ry, color, 1);
    g.globalAlpha = 1;
    drawVerdict(g, W, H, shot, mode, t2);
  }
}

function drawCross(g, cx, cy) {
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 1;
  const r = 9, gap = 3;
  g.beginPath();
  g.moveTo(cx - r, cy); g.lineTo(cx - gap, cy);
  g.moveTo(cx + gap, cy); g.lineTo(cx + r, cy);
  g.moveTo(cx, cy - r); g.lineTo(cx, cy - gap);
  g.moveTo(cx, cy + gap); g.lineTo(cx, cy + r);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath(); g.arc(cx, cy, 1.1, 0, Math.PI * 2); g.fill();
}

/* A small two-ring bullseye. `solid` 1 = the real target, 0.45 = the "seen" ghost. */
function drawTarget(g, x, y, color, alpha) {
  g.save();
  g.globalAlpha *= alpha;
  g.fillStyle = color;
  g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(10,12,16,0.85)';
  g.beginPath(); g.arc(x, y, 6.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = color;
  g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill();
  g.restore();
}

function drawVerdict(g, W, H, shot, mode, t2) {
  g.globalAlpha = t2;
  g.textAlign = 'center';
  g.fillStyle = shot.hit ? ON : OFF;
  g.font = '700 34px system-ui, sans-serif';
  g.fillText(shot.hit ? '✓' : '✗', W / 2, H - 42);
  g.fillStyle = '#cdd6e3';
  g.font = '12px ui-monospace, monospace';
  const msg = mode === 'on'
    ? 'tracked — clean hit'
    : `looked dead-on · missed by ${shot.errDeg.toFixed(1)}°`;
  g.fillText(msg, W / 2, H - 16);
  g.globalAlpha = 1;
}
