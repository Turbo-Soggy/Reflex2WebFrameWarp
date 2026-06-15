/* ---------------------------------------------------------------------------
   audio.js — Procedural sound design (Web Audio, zero downloads)
   ---------------------------------------------------------------------------
   Phase 2 of the Upgrade Series. Sound is the single highest-ROI demo upgrade:
   it turns "I'm clicking in a browser" into "I'm in a shooting range", and it
   reinforces hit/miss without the user reading text.

   Everything here is synthesised on the fly from oscillators + a noise buffer —
   no .wav files to host. That keeps the demo self-contained and offline, exactly
   like the vendored Three.js. Every sound is a short envelope on a node that
   stops itself, so nothing accumulates.

   Browser autoplay policy: an AudioContext can only start from a user gesture,
   so main.js calls resume() on the click-to-enter overlay.
--------------------------------------------------------------------------- */

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.hum = null;
    this.enabled = true; // flips false if Web Audio is unavailable
    this.muted = false;
  }

  /** Create/resume the context on a user gesture. Safe to call repeatedly. */
  resume() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(this.ctx.destination);
      this._noise = this._makeNoise();
      this._startHum();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.6;
  }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  // --- The cues -------------------------------------------------------------

  /** Gunshot: a punchy filtered-noise crack with a short low "body". */
  fire() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'lowpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const g = this._env(0.5, t, 0.001, 0.11);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.14);
    // sub-thump for weight
    this._tone('sine', 120, 70, t, 0.001, 0.10, 0.35);
  }

  /** Hit: a bright, satisfying two-tone "ding". */
  hit() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._tone('sine', 880, 880, t, 0.002, 0.20, 0.35);
    this._tone('sine', 1320, 1320, t + 0.01, 0.002, 0.22, 0.22);
  }

  /** Miss: a dull low thud. */
  miss() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._tone('triangle', 170, 120, t, 0.002, 0.16, 0.3);
  }

  /** Warp ON: a quick rising "power-up". */
  warpOn() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._tone('sawtooth', 300, 720, t, 0.004, 0.18, 0.22);
  }

  /** Warp OFF: a quick falling "power-down". */
  warpOff() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._tone('sawtooth', 600, 220, t, 0.004, 0.20, 0.2);
  }

  // --- Internals ------------------------------------------------------------

  _ok() { return this.enabled && this.ctx && !this.muted; }

  /** A gain node with a fixed attack/decay envelope, ready to connect. */
  _env(peak, t, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  /** One oscillator that optionally sweeps f0→f1, with an envelope, self-stopping. */
  _tone(type, f0, f1, t, attack, decay, peak) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    const g = this._env(peak, t, attack, decay);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + attack + decay + 0.02);
  }

  /** A short loopable white-noise buffer (reused by fire()). */
  _makeNoise() {
    const len = Math.floor(this.ctx.sampleRate * 0.3);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** A barely-there low ambient hum so silence never feels "dead". */
  _startHum() {
    const g = this.ctx.createGain();
    g.gain.value = 0.018;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine'; osc.frequency.value = 58;
    const lfo = this.ctx.createOscillator();   // slow shimmer on the hum
    lfo.frequency.value = 0.12;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 0.006;
    lfo.connect(lfoGain).connect(g.gain);
    osc.connect(g).connect(this.master);
    osc.start(); lfo.start();
    this.hum = osc;
  }
}
