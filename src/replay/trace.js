/* ---------------------------------------------------------------------------
   trace.js — Input traces: the raw material of every controlled experiment
   ---------------------------------------------------------------------------
   A trace is a timestamped pose stream — what the mouse did, divorced from
   what any pipeline did with it. Once a trace is a file, the same input can
   be replayed through N pipeline configurations (lag, guard, rates) and the
   outputs compared with the input held perfectly constant. That replay logic
   lives in pipeline-sim.js; this module owns the data itself:

     • the format (validate / serialise),
     • a browser-side TraceRecorder (records the live demo's input, 'T' key),
     • deterministic synthetic generators (no human needed, no Math.random —
       the noisy one uses a seeded LCG so the same seed is the same trace).

   Format (version 1):
     { version: 1, name, createdAt, samples: [{ t, yaw, pitch }, ...] }
   `t` is milliseconds from trace start, strictly non-decreasing. Replay uses
   zero-order hold: the pose at time x is the newest sample with t ≤ x —
   matching how the live demo sees input (latest event wins until the next).

   Pure except downloadTrace() (browser-only, called only from the demo).
--------------------------------------------------------------------------- */

export const TRACE_VERSION = 1;

/** Throws with a readable message if `trace` is not a valid v1 trace. */
export function validateTrace(trace) {
  if (!trace || trace.version !== TRACE_VERSION) {
    throw new Error(`trace: expected version ${TRACE_VERSION}, got ${trace && trace.version}`);
  }
  if (!Array.isArray(trace.samples) || trace.samples.length === 0) {
    throw new Error('trace: samples must be a non-empty array');
  }
  let prev = -Infinity;
  for (const s of trace.samples) {
    if (!Number.isFinite(s.t) || !Number.isFinite(s.yaw) || !Number.isFinite(s.pitch)) {
      throw new Error(`trace: non-finite sample ${JSON.stringify(s)}`);
    }
    if (s.t < prev) throw new Error(`trace: timestamps go backwards at t=${s.t}`);
    prev = s.t;
  }
  return trace;
}

/** Zero-order hold: the pose in effect at time `t` (newest sample with t ≤ t). */
export function poseAt(trace, t) {
  const ss = trace.samples;
  if (t <= ss[0].t) return ss[0];
  // Binary search for the newest sample at or before t.
  let lo = 0, hi = ss.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ss[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  return ss[lo];
}

/** Duration of the trace in ms (time of the last sample). */
export function traceDurationMs(trace) {
  return trace.samples[trace.samples.length - 1].t;
}

// --- Browser-side recording (the 'T' key in the live demo) ------------------

export class TraceRecorder {
  constructor() {
    this.recording = false;
    this.samples = [];
    this._t0 = 0;
    this._last = null;
  }

  /** Toggle recording. Returns the new state. */
  toggle(now) {
    if (this.recording) {
      this.recording = false;
    } else {
      this.recording = true;
      this.samples = [];
      this._t0 = now;
      this._last = null;
    }
    return this.recording;
  }

  /**
   * Record the current pose (call once per animation tick, same place the lag
   * buffer is fed). Consecutive identical poses are skipped — zero-order-hold
   * replay reconstructs them exactly, so they'd only bloat the file.
   */
  capture(now, yaw, pitch) {
    if (!this.recording) return;
    if (this._last && this._last.yaw === yaw && this._last.pitch === pitch) return;
    const s = { t: now - this._t0, yaw, pitch };
    this.samples.push(s);
    this._last = s;
  }

  toTrace(name = 'recorded') {
    return validateTrace({
      version: TRACE_VERSION,
      name,
      createdAt: new Date().toISOString(),
      samples: this.samples,
    });
  }
}

/** Browser-only: download a trace as a JSON file. */
export function downloadTrace(trace, filename) {
  const blob = new Blob([JSON.stringify(trace)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || `framewarp-trace-${trace.name}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// --- Deterministic synthetic traces ------------------------------------------
// Each generator is a pure function of its options: same options, same trace,
// byte for byte. That property is what makes the benchmark reproducible.

function makeSamples(durationMs, sampleHz, poseFn) {
  const dt = 1000 / sampleHz;
  const samples = [];
  for (let t = 0; t <= durationMs; t += dt) {
    const { yaw, pitch } = poseFn(t);
    samples.push({ t, yaw, pitch });
  }
  return samples;
}

/** Constant yaw velocity — the worst steady case; used for clamp-onset tests. */
export function synthConstantVelocity({ durationMs = 5000, degPerSec = 90, sampleHz = 250 } = {}) {
  const radPerMs = (degPerSec * Math.PI / 180) / 1000;
  return validateTrace({
    version: TRACE_VERSION,
    name: `constant-${degPerSec}degps`,
    createdAt: 'synthetic',
    samples: makeSamples(durationMs, sampleHz, (t) => ({ yaw: t * radPerMs, pitch: 0 })),
  });
}

/** Sinusoidal yaw sweep — smooth direction reversals (tracking-like motion). */
export function synthSineSweep({ durationMs = 5000, amplitudeDeg = 30, freqHz = 0.5, sampleHz = 250 } = {}) {
  const amp = amplitudeDeg * Math.PI / 180;
  const w = 2 * Math.PI * freqHz / 1000;
  return validateTrace({
    version: TRACE_VERSION,
    name: `sine-${amplitudeDeg}deg-${freqHz}hz`,
    createdAt: 'synthetic',
    samples: makeSamples(durationMs, sampleHz, (t) => ({ yaw: amp * Math.sin(w * t), pitch: 0 })),
  });
}

/** A single instantaneous flick of `stepDeg` at `atMs` — the pathological case. */
export function synthFlick({ durationMs = 2000, stepDeg = 40, atMs = 1000, sampleHz = 250 } = {}) {
  const step = stepDeg * Math.PI / 180;
  return validateTrace({
    version: TRACE_VERSION,
    name: `flick-${stepDeg}deg`,
    createdAt: 'synthetic',
    samples: makeSamples(durationMs, sampleHz, (t) => ({ yaw: t >= atMs ? step : 0, pitch: 0 })),
  });
}

/**
 * Seeded wandering look-around: a damped random-walk on angular velocity
 * (Ornstein-Uhlenbeck-flavoured), integrated to yaw/pitch. The closest of the
 * synthetics to real mouse behaviour; same seed → same trace.
 */
export function synthWander({ durationMs = 10000, sampleHz = 250, seed = 1, intensity = 1 } = {}) {
  let s = seed >>> 0;
  const rand = () => { // LCG (Numerical Recipes constants), uniform in [0,1)
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const dt = 1000 / sampleHz;
  let yaw = 0, pitch = 0, vYaw = 0, vPitch = 0;
  const PITCH_LIMIT = Math.PI / 2 - 0.05; // same clamp as input.js
  const samples = [];
  for (let t = 0; t <= durationMs; t += dt) {
    samples.push({ t, yaw, pitch });
    // Velocity in rad/s: nudged by noise, pulled back toward zero (damping).
    vYaw   = vYaw * 0.99 + (rand() - 0.5) * 0.6 * intensity;
    vPitch = vPitch * 0.99 + (rand() - 0.5) * 0.25 * intensity;
    yaw += vYaw * (dt / 1000);
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch + vPitch * (dt / 1000)));
  }
  return validateTrace({
    version: TRACE_VERSION,
    name: `wander-seed${seed}`,
    createdAt: 'synthetic',
    samples,
  });
}
