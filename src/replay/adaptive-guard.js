/* ---------------------------------------------------------------------------
   adaptive-guard.js — Phase 3, Option C: a guard band sized by recent motion
   ---------------------------------------------------------------------------
   The fixed 12% guard band is tuned for "typical gaming sensitivity" — which
   means it is too big almost always (73% extra rendered pixels, mostly never
   sampled) and too small exactly when the player whips the mouse. This module
   sizes it per rendered frame from the velocity the input stream has actually
   been showing.

   The sizing rule inverts THEORY.md §3. The margin must absorb the rotation
   accumulated over a frame's worst-case displayed age A = L + T_r + T_d:

       s = ω̂ · A · safety            (radians the margin must cover)
       Δmax(g) = (g / (1−2g)) · F = s   ⟹   g = s / (F + 2s)

   ω̂ is the max angular speed seen in a recent window — max, not mean,
   because the cost of under-provisioning (visible edge clamping) is worse
   than the cost of over-provisioning (invisible extra pixels), and because
   mouse motion is bursty: the next 100 ms looks like the worst of the last
   few hundred far more often than like their average.

   Deployment honesty: the guard is a SERVER decision applied per rendered
   frame; the client must know each frame's guard to crop correctly. That
   field rides the same pose packet the warp already requires (and the pixel
   tag makes it frame-exact), so the mechanism adds no new channel. What this
   simulation does NOT model: a real video encoder reacts to the content
   scale changing mid-stream (rate control, reference frames) — evaluating
   that needs the live cloud demo, and is noted as the gap between this
   simulation-level result and a shippable feature.

   Honest scope, per the roadmap: a strong SECTION, not a paper spine.
--------------------------------------------------------------------------- */

import { displayFovX, DEFAULT_CONFIG } from './pipeline-sim.js';

const RAD = Math.PI / 180;

export const ADAPTIVE_DEFAULTS = {
  windowMs: 500,  // how much recent motion the estimate looks at
  safety: 1.2,    // headroom multiplier on the observed max speed
  gMin: 0.02,     // never go truly margin-less (sensor noise, late packets)
  gMax: 0.20,     // diminishing returns: g=0.2 already costs 2.8× pixels
};

/**
 * The pure sizing rule: the guard band that absorbs `omegaDegPerSec` for the
 * worst-case displayed-frame age of `config`. Exported separately so the
 * tests can verify the inversion analytically.
 */
export function guardForSpeed(omegaDegPerSec, config = DEFAULT_CONFIG, opts = ADAPTIVE_DEFAULTS) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const ageSec = (cfg.lagMs + 1000 / cfg.renderHz + 1000 / cfg.displayHz) / 1000;
  const s = omegaDegPerSec * RAD * ageSec * opts.safety; // radians to absorb
  const F = displayFovX(cfg);
  const g = s / (F + 2 * s);
  return Math.min(opts.gMax, Math.max(opts.gMin, g));
}

/**
 * A guardPolicy for pipeline-sim.js: per render tick, look at the recent
 * angular-speed window and size the margin for the worst of it.
 */
export function makeAdaptiveGuardPolicy(opts = {}) {
  const o = { ...ADAPTIVE_DEFAULTS, ...opts };
  return ({ now, speeds, config }) => {
    let maxV = 0;
    for (let i = speeds.length - 1; i >= 0 && speeds[i].t >= now - o.windowMs; i--) {
      if (speeds[i].v > maxV) maxV = speeds[i].v;
    }
    return guardForSpeed(maxV, config, o);
  };
}
