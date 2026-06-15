/* ---------------------------------------------------------------------------
   accuracy-chart.js — Rolling hit-rate chart (the result, over time)
   ---------------------------------------------------------------------------
   The latency chart (chart.js) shows the CAUSE — the view-direction lag the warp
   hides. This shows the EFFECT: your hit rate, as a rolling average, plotted per
   mode. Two lines climb apart as you play — warp-on accuracy pulling above
   warp-off — so the story is quantitative and live, not just a number at the end
   (the brief's §4A).

   Honest by construction: each point is the hit rate over the last `window` shots
   in THAT mode, sampled once per shot. The two series advance independently (you
   shoot one mode, then the other), so each line reads as "accuracy within this
   mode as it accumulated". Pure Canvas 2D, no dependencies — same palette and
   shape as chart.js so the two panels read as a pair.
--------------------------------------------------------------------------- */

const COLORS = {
  off: '#ff7a5c',  // WITHOUT WARP — matches the latency chart's no-warp line
  on: '#4cc2ff',   // WITH WARP    — matches the latency chart's warp line
  grid: 'rgba(255,255,255,0.08)',
  text: '#8b97a7',
};

export class AccuracyChart {
  /**
   * @param canvas   a 2D canvas element
   * @param window   rolling window size, in shots, for the hit-rate average
   * @param maxPoints how many samples to keep per series (the visible history)
   */
  constructor(canvas, { window = 12, maxPoints = 120 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.window = window;
    this.maxPoints = maxPoints;

    // Recent raw shots (1 = hit, 0 = miss) per mode, capped at `window`.
    this._recent = { off: [], on: [] };
    // Sampled rolling hit-rate (%) per mode — the plotted series.
    this.series = { off: [], on: [] };
    this._lastDraw = 0;
  }

  /** Record one shot. `warpOn` picks the bucket; `hit` is the outcome. */
  record(warpOn, hit) {
    const key = warpOn ? 'on' : 'off';
    const recent = this._recent[key];
    recent.push(hit ? 1 : 0);
    if (recent.length > this.window) recent.shift();

    const rate = (recent.reduce((a, b) => a + b, 0) / recent.length) * 100;
    const s = this.series[key];
    s.push(rate);
    if (s.length > this.maxPoints) s.shift();
  }

  reset() {
    this._recent = { off: [], on: [] };
    this.series = { off: [], on: [] };
  }

  /** Draw both series (0–100%). Throttled internally to ~30 Hz. */
  draw(now) {
    if (now - this._lastDraw < 33) return;
    this._lastDraw = now;

    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const padL = 30, padB = 6, padT = 6, padR = 6;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    ctx.clearRect(0, 0, W, H);

    // Gridlines + % labels at 0 / 50 / 100.
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const pct of [0, 50, 100]) {
      const y = padT + plotH - (pct / 100) * plotH;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.fillText(pct.toString(), padL - 5, y);
    }

    this._line(this.series.off, COLORS.off, padL, padT, plotW, plotH);
    this._line(this.series.on, COLORS.on, padL, padT, plotW, plotH);

    // Current rolling rate, top-right, for each mode that has data.
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    this._latest(this.series.off, COLORS.off, W - padR, padT);
    this._latest(this.series.on, COLORS.on, W - padR, padT + 11);
  }

  _latest(series, color, xRight, y) {
    if (!series.length) return;
    this.ctx.fillStyle = color;
    this.ctx.fillText(`${Math.round(series[series.length - 1])}%`, xRight, y);
  }

  _line(series, color, padL, padT, plotW, plotH) {
    if (!series || series.length < 2) return;
    const { ctx } = this;
    const n = series.length;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = padL + (i / (n - 1)) * plotW;
      const y = padT + plotH - (series[i] / 100) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
