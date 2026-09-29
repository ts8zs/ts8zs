/* Canvas K 线渲染：蜡烛 + 网格 + 持仓线 + 当前价，零依赖 */
(function (global) {
  'use strict';

  const PAD_R = 62;   // 右侧价格轴
  const PAD_B = 22;   // 底部时间轴
  const PAD_T = 10;

  class KLineChart {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.viewCount = 120;   // 可视 K 线根数
      this.offset = 0;        // 右边缘偏移（0 = 贴最新）
      this.crosshair = null;
      this.dpr = 1;
      this._resize();
      window.addEventListener('resize', () => this._resize());
      // 布局会因 tabs 换行、面板增减等原因变化，而这些都不会触发 window resize，
      // 必须直接观察容器尺寸，否则旧尺寸的 canvas 会溢出盖住周期栏和底栏
      if (window.ResizeObserver) {
        this._ro = new ResizeObserver(() => this._resize());
        this._ro.observe(this.canvas.parentElement);
      }
    }

    _resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      // 尺寸没变就不写回，避免 observer 与自身写入互相触发
      if (w === this.w && h === this.h && dpr === this.dpr) return;
      this.dpr = dpr;
      this.w = w;
      this.h = h;
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    zoom(delta) {
      this.viewCount = Math.min(400, Math.max(30, this.viewCount + delta));
    }

    pan(delta) {
      this.offset = Math.max(0, this.offset + delta);
    }

    reset() {
      this.offset = 0;
    }

    /**
     * @param {Array} candles K 线数组
     * @param {object} opt {digits, bid, ask, orders:[{entry,sl,tp,side}], digits}
     */
    draw(candles, opt) {
      const ctx = this.ctx;
      const w = this.w;
      const h = this.h;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, w, h);

      if (!candles.length) return;

      const total = candles.length;
      const count = Math.min(this.viewCount, total);
      const endIdx = Math.max(count, total - this.offset);
      const startIdx = Math.max(0, endIdx - count);
      const view = candles.slice(startIdx, endIdx);

      const plotW = w - PAD_R;
      const plotH = h - PAD_B - PAD_T;

      // 价格范围
      let min = Infinity;
      let max = -Infinity;
      for (const c of view) {
        if (c.l < min) min = c.l;
        if (c.h > max) max = c.h;
      }
      // 把持仓线纳入视野
      for (const o of opt.orders || []) {
        [o.entry, o.sl, o.tp].forEach((v) => {
          if (typeof v === 'number' && isFinite(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
          }
        });
      }
      const pad = (max - min) * 0.08 || max * 0.001;
      min -= pad;
      max += pad;

      const price2y = (p) => PAD_T + ((max - p) / (max - min)) * plotH;
      const x2i = (x) => startIdx + Math.floor((x / plotW) * view.length);
      const barW = plotW / view.length;
      const cx = (i) => (i - startIdx) * barW + barW / 2;

      /* 网格 */
      ctx.strokeStyle = '#1b2230';
      ctx.lineWidth = 1;
      ctx.font = '11px ui-monospace, Consolas, monospace';
      ctx.fillStyle = '#5b6676';
      ctx.textBaseline = 'middle';
      const rows = 5;
      for (let r = 0; r <= rows; r++) {
        const p = min + ((max - min) * r) / rows;
        const y = Math.round(price2y(p)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.fillText(p.toFixed(opt.digits), plotW + 6, y);
      }

      /* 蜡烛 */
      const bodyW = Math.max(1, Math.min(14, barW * 0.66));
      for (let i = 0; i < view.length; i++) {
        const c = view[i];
        const up = c.c >= c.o;
        const col = up ? '#26a69a' : '#ef5350';
        const x = cx(startIdx + i);
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, price2y(c.h));
        ctx.lineTo(Math.round(x) + 0.5, price2y(c.l));
        ctx.stroke();
        const yO = price2y(c.o);
        const yC = price2y(c.c);
        const top = Math.min(yO, yC);
        const hh = Math.max(1, Math.abs(yC - yO));
        ctx.fillRect(x - bodyW / 2, top, bodyW, hh);
      }

      /* 持仓线 */
      for (const o of opt.orders || []) {
        this._hLine(ctx, plotW, price2y(o.entry), '#8ab4f8', ` ${o.side === 'buy' ? '多' : '空'} ${o.entry.toFixed(opt.digits)}`);
        if (o.sl !== null && isFinite(o.sl)) this._hLine(ctx, plotW, price2y(o.sl), '#ef5350', ` SL ${o.sl.toFixed(opt.digits)}`);
        if (o.tp !== null && isFinite(o.tp)) this._hLine(ctx, plotW, price2y(o.tp), '#26a69a', ` TP ${o.tp.toFixed(opt.digits)}`);
      }

      /* 当前价线 */
      const yNow = price2y(opt.ask);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#f0b90b';
      ctx.beginPath();
      ctx.moveTo(0, yNow);
      ctx.lineTo(plotW, yNow);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f0b90b';
      ctx.fillRect(plotW + 2, yNow - 8, PAD_R - 4, 16);
      ctx.fillStyle = '#0d1117';
      ctx.textAlign = 'left';
      ctx.fillText(opt.ask.toFixed(opt.digits), plotW + 6, yNow);

      /* 十字光标 */
      if (this.crosshair) {
        const { x, y } = this.crosshair;
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = '#6b7789';
        ctx.beginPath();
        ctx.moveTo(x, PAD_T);
        ctx.lineTo(x, h - PAD_B);
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        const p = max - ((y - PAD_T) / plotH) * (max - min);
        ctx.fillStyle = '#6b7789';
        ctx.fillRect(plotW + 2, y - 8, PAD_R - 4, 16);
        ctx.fillStyle = '#0d1117';
        ctx.fillText(p.toFixed(opt.digits), plotW + 6, y);

        const ci = Math.min(view.length - 1, Math.max(0, x2i(x) - startIdx));
        const c = view[ci];
        if (c) {
          ctx.fillStyle = '#161b22';
          ctx.fillRect(4, PAD_T + 4, 132, 62);
          ctx.fillStyle = '#c9d1d9';
          ctx.font = '11px ui-monospace, Consolas, monospace';
          ctx.fillText(`O ${c.o.toFixed(opt.digits)}`, 10, PAD_T + 16);
          ctx.fillText(`H ${c.h.toFixed(opt.digits)}`, 10, PAD_T + 30);
          ctx.fillText(`L ${c.l.toFixed(opt.digits)}`, 10, PAD_T + 44);
          ctx.fillText(`C ${c.c.toFixed(opt.digits)}`, 10, PAD_T + 58);
        }
      }
    }

    _hLine(ctx, plotW, y, color, label) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(plotW, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '11px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = color;
      ctx.fillText(label, 6, y - 2);
      ctx.textBaseline = 'middle';
    }
  }

  global.FXChart = KLineChart;
})(window);
