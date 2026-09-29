/* 行情引擎：GBM + 波动率状态机 + 事件跳跃，纯逻辑无 DOM */
(function (global) {
  'use strict';

  const { TF_MINUTES, TIMEFRAMES, VOL_STATES, EVENTS, RULES, STORY_EVENTS } = global.FXConfig;
  const { makeRng } = global.FXRng;

  const SUB_STEPS = 6;          // 每根 M1 K 线内部细分数，用于生成影线
  const MAX_BARS = { M1: 600, M5: 600, M15: 600, H1: 600, H4: 400, D1: 300 };

  class Market {
    /**
     * @param {string} symbol 品种代码
     * @param {number|string} seed 种子，决定整段行情
     */
    constructor(symbol, seed) {
      this.inst = global.FXConfig.INSTRUMENTS[symbol];
      this.symbol = symbol;
      this.seed = seed;
      this.rng = makeRng(global.FXRng.hashSeed(String(seed) + ':' + symbol));

      this.price = this.inst.price;
      this.anchor = this.inst.price;      // 弱锚定的基准，随宏观趋势一起移动
      this.tickIndex = 0;                 // 已生成的 M1 根数
      this.simMinutes = 6 * 60;           // 从某个交易日 06:00 起步
      this.day = 1;

      this.volState = VOL_STATES[1];
      this.stateLeft = 60;
      this.event = null;                  // {name, impact, left}
      this.nextEventAt = RULES.eventEveryTicks;
      this.firedStories = new Set();      // 已播出的剧情，防止重复触发
      this.storyDrift = null;             // {left, perTick} 剧情后的回归推力

      this.candles = {};
      TIMEFRAMES.forEach((tf) => (this.candles[tf] = []));

      this._warmup();
    }

    /* ---------- 对外接口 ---------- */

    get spread() { return this.inst.spread; }
    get bid() { return this.price - this.inst.spread / 2; }
    get ask() { return this.price + this.inst.spread / 2; }

    /** 推进 1 个 tick（= 1 分钟行情）@returns {{event, story}} 本 tick 触发的事件 */
    tick() {
      this._advanceState();
      let jumped = null;

      if (this.tickIndex >= this.nextEventAt) {
        if (this.storyDrift) {
          // 剧情回归期间不叠加随机新闻，否则跳空会把「日元短暂升值」的形态盖掉
          this.nextEventAt = this.tickIndex + 30;
        } else {
          jumped = this._fireEvent();
        }
      }
      if (this.event) {
        this.event.left -= 1;
        if (this.event.left <= 0) this.event = null;
      }

      const bar = this._genBar();
      this.price = bar.c;
      this.tickIndex += 1;
      this._pushBar(bar);

      this.simMinutes += 1;
      if (this.simMinutes >= 24 * 60) {
        this.simMinutes = 0;
        this.day += 1;
        this.newDay = true;
      } else {
        this.newDay = false;
      }

      // 跨日时检查剧情事件（如《FX战士》每周更新）
      let story = null;
      if (this.newDay) story = this._checkStory();

      return { event: jumped, story };
    }

    getCandles(tf) {
      return this.candles[tf] || this.candles.M1;
    }

    /**
     * 快进到指定 tick。行情由种子完全决定，重放即可精确还原价格与波动状态，
     * 无需保存整段 K 线数据（存档体积因此极小）
     */
    fastForward(targetTick) {
      let guard = 0;
      while (this.tickIndex < targetTick && guard++ < 200000) this.tick();
      return this.tickIndex;
    }

    /** 存档序列化：只存进度与剧情状态，K 线由种子重放还原 */
    serialize() {
      return {
        tick: this.tickIndex,
        fired: Array.from(this.firedStories),
        story: this.storyDrift ? { left: this.storyDrift.left, perTick: this.storyDrift.perTick } : null
      };
    }

    restoreState(data) {
      this.fastForward(data && data.tick ? data.tick : 0);
      this.firedStories = new Set((data && data.fired) || []);
      this.storyDrift = (data && data.story) || null;
    }

    clockLabel() {
      const h = Math.floor(this.simMinutes / 60);
      const m = this.simMinutes % 60;
      return `D${this.day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    /* ---------- 内部实现 ---------- */

    _warmup() {
      // 预热：不触发事件，纯随机漫步，产出开盘前历史 K 线
      const n = RULES.warmupBars;
      for (let i = 0; i < n; i++) {
        const bar = this._genBar();
        this.price = bar.c;
        this.tickIndex += 1;
        this._pushBar(bar);
      }
      this.nextEventAt = this.tickIndex + RULES.eventEveryTicks;
    }

    _advanceState() {
      this.stateLeft -= 1;
      if (this.stateLeft <= 0) {
        this.volState = this._pickState();
        this.stateLeft = Math.floor(
          this.volState.minTicks + this.rng() * (this.volState.maxTicks - this.volState.minTicks)
        );
      }
    }

    _pickState() {
      const total = VOL_STATES.reduce((s, v) => s + v.weight, 0);
      let r = this.rng() * total;
      for (const st of VOL_STATES) {
        r -= st.weight;
        if (r <= 0) return st;
      }
      return VOL_STATES[1];
    }

    _fireEvent() {
      const ev = EVENTS[Math.floor(this.rng() * EVENTS.length)];
      const dir = this.rng() < 0.5 ? -1 : 1;
      // 事件瞬间跳空，幅度按品种波动率缩放（约 0.6~1.4 倍基准）
      const amp = this.inst.sigmaTick * ev.jump * dir * (0.6 + this.rng() * 0.8);
      this.price = this.price * (1 + amp);

      this.volState = VOL_STATES[3];
      this.stateLeft = this.volState.minTicks;
      this.event = { name: ev.name, impact: ev.impact, left: 15 };
      this.nextEventAt = this.tickIndex + Math.floor(RULES.eventEveryTicks * (0.6 + this.rng() * 0.9));

      return { name: ev.name, impact: ev.impact, dir: dir > 0 ? 'up' : 'down' };
    }

    /**
     * 跨日检查剧情事件（如《FX战士》播出 → 日元短线走强）。
     * 锚点不变，所以在 bars 内价格会被 storyDrift 推回原本的趋势轨道
     */
    _checkStory() {
      for (const ev of STORY_EVENTS) {
        if (ev.symbol !== this.symbol || ev.day !== this.day) continue;
        const key = 'EP' + ev.ep;
        if (this.firedStories.has(key)) continue;

        this.firedStories.add(key);
        this.price = this.price * (1 + ev.jump);          // 瞬间跳空
        this.storyDrift = { left: ev.bars, perTick: -ev.jump / ev.bars }; // 之后缓慢回归
        this.volState = VOL_STATES[2];                    // 进入活跃波动
        this.stateLeft = ev.bars;
        return { episode: ev.ep, title: ev.title, jump: ev.jump };
      }
      return null;
    }

    /** 用 GBM 生成一根带影线的 M1 K 线 */
    _genBar() {
      const open = this.price;
      const base = this.inst.sigmaTick * this.volState.mult;
      const stepSigma = base / Math.sqrt(SUB_STEPS);
      // 宏观趋势（如日元长期贬值）与剧情后的回归推力，都按 sub-step 均摊
      const stepDrift = (this.inst.driftTick || 0) / SUB_STEPS;
      const stepStory = this.storyDrift ? this.storyDrift.perTick / SUB_STEPS : 0;

      let last = open;
      let high = open;
      let low = open;
      for (let i = 0; i < SUB_STEPS; i++) {
        const z = this.rng.gauss();
        // 极弱锚定（每 sub-step 0.01%）只用于防止长时间运行后漂移到离谱价位。
        // 锚点必须跟着宏观趋势走，否则回归力会把 drift 硬拉回去
        const pull = -0.0001 * Math.log(last / this.anchor);
        last = last * Math.exp(-0.5 * stepSigma * stepSigma + stepSigma * z + pull + stepDrift + stepStory);
        if (last > high) high = last;
        if (last < low) low = last;
      }

      this.anchor = this.anchor * Math.exp(this.inst.driftTick || 0);
      if (this.storyDrift) {
        this.storyDrift.left -= 1;
        if (this.storyDrift.left <= 0) this.storyDrift = null;
      }
      return { t: this.tickIndex, o: open, h: high, l: low, c: last };
    }

    _pushBar(bar) {
      for (const tf of TIMEFRAMES) {
        const n = TF_MINUTES[tf];
        const arr = this.candles[tf];
        const idx = Math.floor(bar.t / n);
        const last = arr[arr.length - 1];

        if (!last || last.i !== idx) {
          arr.push({ i: idx, t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c });
          if (arr.length > MAX_BARS[tf]) arr.shift();
        } else {
          if (bar.h > last.h) last.h = bar.h;
          if (bar.l < last.l) last.l = bar.l;
          last.c = bar.c;
        }
      }
    }
  }

  global.FXMarket = Market;
})(window);
