/* ---------------------------------------------------------------------------
   chart.js — Live latency chart (your key demo visual)
   ---------------------------------------------------------------------------
   A small 2D-canvas line graph plotting the two view-direction latencies over
   time: the lagged (no-warp) half vs the warped half. This is the picture that
   sells the result to a judge — two lines, a big steady gap between them.

   Pure Canvas 2D, no dependencies. Drawn straight from the Latency ring buffers.
--------------------------------------------------------------------------- */

const COLORS = {
  noWarp: '#ff7a5c',
  warp: '#4cc2ff',
  grid: 'rgba(255,255,255,0.08)',
  text: '#8b97a7',
};

// Auto-range: the y-axis top is the max of both series over the buffer, rounded
// up to the next STEP_MS, never below MIN_MAX_MS. So the no-warp line (injected
// lag + frame wait) is never pinned flat against the top of the plot.
const STEP_MS = 50;
const MIN_MAX_MS = 100;

export class LatencyChart {
  /**
   * @param canvas
   * @param opts.maxMs optional hard override for the y-axis top (ms). Omit for
   *                   auto-ranging.
   */
  constructor(canvas, { maxMs } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fixedMaxMs = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : null;
    this.maxMs = this.fixedMaxMs ?? MIN_MAX_MS; // current axis top (ms)
    this._lastDraw = 0;
  }

  /** Axis top for the given series: the hard override, or the auto range. */
  _axisMax(a, b) {
    if (this.fixedMaxMs) return this.fixedMaxMs;
    let peak = 0;
    for (const s of [a, b]) {
      if (!s) continue;
      for (const v of s) if (Number.isFinite(v) && v > peak) peak = v;
    }
    return Math.max(MIN_MAX_MS, Math.ceil(peak / STEP_MS) * STEP_MS);
  }

  /**
   * Draw the two latency series. Throttled internally to ~30 Hz.
   * @param markers optional [{ x: 0..1, on: bool }] vertical guides drawn where
   *                Frame Warp was toggled (Phase 5).
   */
  draw(now, noWarpSeries, warpSeries, markers = []) {
    if (now - this._lastDraw < 33) return;
    this._lastDraw = now;

    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const padL = 30, padB = 14, padT = 6, padR = 6;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    ctx.clearRect(0, 0, W, H);

    this.maxMs = this._axisMax(noWarpSeries, warpSeries);
    // Gridline spacing adapts so the axis keeps ~3-6 labelled lines.
    const gridStep = this.maxMs <= 300 ? STEP_MS : Math.ceil(this.maxMs / 5 / STEP_MS) * STEP_MS;

    // Horizontal gridlines + ms labels.
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let ms = 0; ms <= this.maxMs; ms += gridStep) {
      const y = padT + plotH - (ms / this.maxMs) * plotH;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.fillText(ms.toString(), padL - 5, y);
    }

    // Vertical dashed guides at each W toggle, so the chart shows exactly when
    // the mode changed (cool = warp on, warm = warp off).
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    for (const m of markers) {
      if (m.x < 0 || m.x > 1) continue;
      const x = padL + m.x * plotW;
      ctx.strokeStyle = m.on ? COLORS.warp : COLORS.noWarp;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    this._line(noWarpSeries, COLORS.noWarp, padL, padT, plotW, plotH);
    this._line(warpSeries, COLORS.warp, padL, padT, plotW, plotH);

    // Inline μ / p95 annotations (top-right), the stats a report figure wants.
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    this._annotate(noWarpSeries, COLORS.noWarp, W - padR, padT, padL);
    this._annotate(warpSeries, COLORS.warp, W - padR, padT + 11, padL);
  }

  /** Draw "μNN p95 NN" for one series at (xRight, y). */
  _annotate(series, color, xRight, y, padL) {
    if (!series || series.length < 2) return;
    const mean = series.reduce((a, b) => a + b, 0) / series.length;
    const sorted = series.slice().sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    this.ctx.fillStyle = color;
    this.ctx.fillText(`μ${mean.toFixed(0)}  p95 ${p95.toFixed(0)}`, xRight, y);
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
      const v = Math.min(series[i], this.maxMs);
      const y = padT + plotH - (v / this.maxMs) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
