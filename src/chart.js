/* ---------------------------------------------------------------------------
   chart.js — Live latency chart (your key demo visual)
   ---------------------------------------------------------------------------
   A small 2D-canvas line graph plotting the two view-direction latencies over
   time: the lagged (no-warp) half vs the warped half. This is the picture that
   sells the result to a judge — two lines, a big steady gap between them.

   Pure Canvas 2D, no dependencies. Drawn straight from the Latency ring buffers.
--------------------------------------------------------------------------- */

const COLORS = {
  left: '#ff7a5c',   // lagged
  right: '#4cc2ff',  // warped
  grid: 'rgba(255,255,255,0.08)',
  text: '#8b97a7',
};

export class LatencyChart {
  constructor(canvas, { maxMs = 150 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.maxMs = maxMs;
    this._lastDraw = 0;
  }

  /** Draw the two latency series. Throttled internally to ~30 Hz. */
  draw(now, leftSeries, rightSeries) {
    if (now - this._lastDraw < 33) return;
    this._lastDraw = now;

    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const padL = 30, padB = 14, padT = 6, padR = 6;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    ctx.clearRect(0, 0, W, H);

    // Horizontal gridlines + ms labels.
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let ms = 0; ms <= this.maxMs; ms += 50) {
      const y = padT + plotH - (ms / this.maxMs) * plotH;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.fillText(ms.toString(), padL - 5, y);
    }

    this._line(leftSeries, COLORS.left, padL, padT, plotW, plotH);
    this._line(rightSeries, COLORS.right, padL, padT, plotW, plotH);
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
