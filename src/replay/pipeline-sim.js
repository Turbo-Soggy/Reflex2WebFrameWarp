/* ---------------------------------------------------------------------------
   pipeline-sim.js — Deterministic headless simulation of the warp pipeline
   ---------------------------------------------------------------------------
   The research instrument. It replays an input trace (trace.js) through the
   SAME two-clock pipeline the live demo runs — the actual LagSim class from
   lag.js, the same display/render tick structure as main.js's loop, the same
   warp delta math — but with a simulated clock instead of rAF, so:

     • it is bit-exact reproducible (no rAF jitter, no Date, no randomness),
     • it runs in Node with no GPU and no human (thousands of runs are cheap),
     • the same trace can be pushed through N configurations and compared.

   What it models, per display tick:
     true pose (zero-order hold from the trace)
       └► recorded into LagSim          (main.js: lag.record(now, snapshot))
     render tick? (LagSim.shouldRender) (main.js: the 30 FPS branch)
       └► rendered pose = LagSim.orientationToRender(now)   — lagMs old
     displayed pose:
       no-warp = the rendered pose (raw lagged frame)
       warp    = rendered pose + delta, where the delta is CLAMPED to what the
                 guard band can supply: |Δyaw| ≤ (guard/uScale)·fovX, and
                 likewise for pitch. Past that the shader edge-clamps — the
                 documented fallback — so view-direction error reappears.

   What it does NOT model: pixel content. The warp's small-angle linearisation
   error (UV shift is linear in angle; true reprojection is linear in tangent)
   is a within-frame pixel position error, derived analytically in
   docs/THEORY.md — it does not move the view direction at screen centre,
   which is what this simulator measures.
--------------------------------------------------------------------------- */

import { LagSim } from '../lag.js';
import { validateTrace, poseAt, traceDurationMs } from './trace.js';
import { percentile } from '../cloud/cloud-recorder.js';

export const DEFAULT_CONFIG = {
  displayHz: 60,        // composite (rAF) rate
  renderHz: 30,         // source render cap (the simulated heavy game)
  lagMs: 80,            // injected pipeline latency
  guard: 0.12,          // guard-band margin per side, texture-relative
  displayFovYDeg: 75,   // what the user sees (main.js: DISPLAY_FOV_Y)
  aspect: 16 / 9,
  warmupMs: 500,        // ticks before this are simulated but excluded from
                        // the summary (the lag buffer starts empty, so the
                        // first frames are artificially stale)
};

const RAD = Math.PI / 180;

/** Horizontal display FOV in radians — same formula as main.js / client-main.js. */
export function displayFovX(config) {
  const fovY = config.displayFovYDeg * RAD;
  return 2 * Math.atan(Math.tan(fovY / 2) * config.aspect);
}

/**
 * The largest angular delta the warp can apply before the sample UV leaves the
 * texture (shader: sampleUV = guard + (vUv+delta)·uScale escapes [0,1] at the
 * screen edge once |delta| > guard/uScale). Returns radians {yaw, pitch}.
 */
export function maxWarpRad(config) {
  const uScale = 1 - 2 * config.guard;
  const maxShiftUV = config.guard / uScale;
  return {
    yaw: maxShiftUV * displayFovX(config),
    pitch: maxShiftUV * (config.displayFovYDeg * RAD),
  };
}

/**
 * Analytic clamp-onset bounds for a constant yaw velocity (deg/s): the warp
 * starts clamping somewhere in [lower, upper], because the displayed frame's
 * age in steady state lies in [lagMs, lagMs + renderInterval + displayTick].
 * A frame is lagMs old the moment it is rendered, ages by up to one render
 * interval before the next frame replaces it — and that replacement can land
 * one display tick late, because renders only happen on display ticks (the
 * "individual frames jitter by a tick" note in lag.js, now load-bearing).
 * Validated against the simulator in test/test.js — the theory-meets-
 * instrument loop of the roadmap's Phase 2.
 */
export function clampOnsetBoundsDegPerSec(config = DEFAULT_CONFIG) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const maxYaw = maxWarpRad(cfg).yaw;                      // radians
  const ageMin = cfg.lagMs / 1000;                         // seconds
  const ageMax = (cfg.lagMs + 1000 / cfg.renderHz + 1000 / cfg.displayHz) / 1000;
  return {
    lowerDegPerSec: (maxYaw / ageMax) / RAD,
    upperDegPerSec: (maxYaw / ageMin) / RAD,
    maxWarpDeg: maxYaw / RAD,
  };
}

/**
 * Replay `trace` through one pipeline configuration.
 * Returns { config, ticks, summary } — ticks is one record per display tick.
 */
export function simulate(trace, config = {}) {
  validateTrace(trace);
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const fovX = displayFovX(cfg);
  const maxWarp = maxWarpRad(cfg);
  const lag = new LagSim(cfg.renderHz, cfg.lagMs);

  const dt = 1000 / cfg.displayHz;
  const durationMs = traceDurationMs(trace);

  // Rendered-frame state, exactly as main.js keeps it on warpTarget.
  let rendered = { yaw: 0, pitch: 0, t: 0 };

  const ticks = [];
  for (let i = 0; i * dt <= durationMs; i++) {
    const now = i * dt;

    // FAST CLOCK: the freshest input this tick (zero-order hold from the trace).
    const truePose = poseAt(trace, now);
    lag.record(now, truePose);

    // SLOW CLOCK: maybe render a new (deliberately stale) frame.
    if (lag.shouldRender(now)) {
      const o = lag.orientationToRender(now);
      rendered = { yaw: o.yaw, pitch: o.pitch, t: o.t !== undefined ? o.t : now };
    }

    // COMPOSITE: how far has the camera moved since the displayed frame?
    const dYaw = truePose.yaw - rendered.yaw;
    const dPitch = truePose.pitch - rendered.pitch;

    // The warp applies the delta, but only as far as the guard band reaches.
    const appliedYaw = Math.max(-maxWarp.yaw, Math.min(maxWarp.yaw, dYaw));
    const appliedPitch = Math.max(-maxWarp.pitch, Math.min(maxWarp.pitch, dPitch));
    const clamped = appliedYaw !== dYaw || appliedPitch !== dPitch;

    // View-direction error (degrees): displayed orientation vs true orientation.
    const errNoWarpDeg = Math.hypot(dYaw, dPitch) / RAD;
    const errWarpDeg = Math.hypot(dYaw - appliedYaw, dPitch - appliedPitch) / RAD;

    // How much of the margin this tick consumed (1.0 = exhausted). Reported
    // unclamped so post-onset overshoot is visible in the data.
    const guardUsed = Math.max(Math.abs(dYaw) / maxWarp.yaw, Math.abs(dPitch) / maxWarp.pitch);

    ticks.push({
      t: now,
      trueYaw: truePose.yaw, truePitch: truePose.pitch,
      stalenessMs: now - rendered.t,   // age of the displayed frame's input
      errNoWarpDeg, errWarpDeg, guardUsed,
      clamped: clamped ? 1 : 0,
    });
  }

  // Summary over the post-warmup window.
  const window_ = ticks.filter((k) => k.t >= cfg.warmupMs);
  const of = (sel) => window_.map(sel);
  const stats = (vals) => ({
    mean: vals.reduce((a, b) => a + b, 0) / vals.length,
    p95: percentile(vals, 95),
    max: vals.reduce((a, b) => (b > a ? b : a), -Infinity), // no spread: long traces
  });
  const summary = {
    trace: trace.name,
    ticks: window_.length,
    clampRate: of((k) => k.clamped).reduce((a, b) => a + b, 0) / window_.length,
    errNoWarpDeg: stats(of((k) => k.errNoWarpDeg)),
    errWarpDeg: stats(of((k) => k.errWarpDeg)),
    stalenessMs: stats(of((k) => k.stalenessMs)),
    guardUsed: stats(of((k) => k.guardUsed)),
  };

  return { config: cfg, fovXRad: fovX, ticks, summary };
}

/** Serialise a simulate() result as CSV (per-tick rows + a # summary block). */
export function resultToCSV(result) {
  const header = 'time_ms,true_yaw_deg,true_pitch_deg,staleness_ms,err_nowarp_deg,err_warp_deg,guard_used,clamped';
  const rows = result.ticks.map((k) =>
    [k.t.toFixed(3), (k.trueYaw / RAD).toFixed(4), (k.truePitch / RAD).toFixed(4),
     k.stalenessMs.toFixed(3), k.errNoWarpDeg.toFixed(4), k.errWarpDeg.toFixed(4),
     k.guardUsed.toFixed(4), k.clamped].join(','));
  const s = result.summary;
  const fmt = (o) => `${o.mean.toFixed(4)}/${o.p95.toFixed(4)}/${o.max.toFixed(4)}`;
  const lines = [
    '#',
    `# trace,${s.trace}`,
    `# config,lagMs=${result.config.lagMs},renderHz=${result.config.renderHz},displayHz=${result.config.displayHz},guard=${result.config.guard}`,
    `# ticks(post-warmup),${s.ticks}`,
    `# clamp_rate,${s.clampRate.toFixed(6)}`,
    `# err_nowarp_deg(mean/p95/max),${fmt(s.errNoWarpDeg)}`,
    `# err_warp_deg(mean/p95/max),${fmt(s.errWarpDeg)}`,
    `# staleness_ms(mean/p95/max),${fmt(s.stalenessMs)}`,
    `# guard_used(mean/p95/max),${fmt(s.guardUsed)}`,
  ];
  return [header, ...rows, ...lines].join('\n') + '\n';
}
