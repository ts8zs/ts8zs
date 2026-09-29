/* 账户与订单：保证金、浮盈、SL/TP 触发、强制平仓、隔夜利息 */
(function (global) {
  'use strict';

  const { COSTS, RULES, INSTRUMENTS } = global.FXConfig;

  let _oid = 1;

  /** 恢复存档后同步订单号，避免新开的单与恢复出来的持仓撞 id */
  function resumeOrderId(orders) {
    for (const o of orders || []) {
      if (o && o.id >= _oid) _oid = o.id + 1;
    }
  }

  class Account {
    constructor(balance) {
      this.balance = balance;
      this.orders = [];   // 持仓
      this.history = [];  // 已成交
      this.leverage = RULES.defaultLeverage;
      this.peakEquity = balance;
      this.blown = false;
    }

    /* ---------- 计算 ---------- */

    /** 单笔浮盈（未扣隔夜利息） */
    static pnlOf(o, price) {
      let diff = (price - o.entry) * (o.side === 'buy' ? 1 : -1);
      if (o.inverse) diff = diff / price;
      return diff * o.lots * o.contractSize;
    }

    /**
     * 名义价值（以账户货币 USD 计）。
     * 直接报价（EURUSD 等）：USD 是报价货币，名义值 = 价格 × 合约量；
     * 间接报价（USDJPY，inverse）：USD 是基础货币，合约量本身就是 USD，不再乘价格
     */
    static notionalOf(o) {
      const units = o.lots * o.contractSize;
      return o.inverse ? units : o.entry * units;
    }

    /** 单笔占用保证金 */
    static marginOf(o) {
      return Account.notionalOf(o) / o.leverage;
    }

    get floating() {
      return this.orders.reduce((s, o) => s + Account.pnlOf(o, o.mark), 0);
    }

    get equity() {
      return this.balance + this.floating;
    }

    get usedMargin() {
      return this.orders.reduce((s, o) => s + Account.marginOf(o), 0);
    }

    get freeMargin() {
      return this.equity - this.usedMargin;
    }

    get marginLevel() {
      const m = this.usedMargin;
      return m > 0 ? (this.equity / m) * 100 : Infinity;
    }

    /* ---------- 操作 ---------- */

    /**
     * @param {object} p {symbol, side, lots, price(原始中间价), sl, tp, leverage}
     * @returns {{ok:boolean, msg?:string, order?:object}}
     */
    open(p) {
      if (this.blown) return { ok: false, msg: '账户已清算，请重开一局' };
      const inst = INSTRUMENTS[p.symbol];
      const lots = Number(p.lots);
      if (!isFinite(lots) || lots < inst.minLot) return { ok: false, msg: '手数过小' };
      if (lots > inst.maxLot) return { ok: false, msg: '手数超过上限' };

      // 点差：买入按 ask，卖出按 bid
      const entry = p.side === 'buy' ? p.price + inst.spread / 2 : p.price - inst.spread / 2;
      const order = {
        id: _oid++,
        symbol: p.symbol,
        side: p.side,
        lots,
        entry,
        mark: entry,
        sl: p.sl ? Number(p.sl) : null,
        tp: p.tp ? Number(p.tp) : null,
        leverage: p.leverage,
        contractSize: inst.contractSize,
        inverse: !!inst.inverse,
        digits: inst.digits,
        openTick: p.tick || 0,
        swap: 0
      };

      // SL / TP 必须位于正确一侧。否则残留的其它品种价格会造出
      // 「一开仓立刻按离谱价格成交」的巨额亏损
      const mid = p.price;
      if (order.sl !== null) {
        if (p.side === 'buy' && order.sl >= mid) return { ok: false, msg: '做多止损价须低于现价' };
        if (p.side === 'sell' && order.sl <= mid) return { ok: false, msg: '做空止损价须高于现价' };
      }
      if (order.tp !== null) {
        if (p.side === 'buy' && order.tp <= mid) return { ok: false, msg: '做多止盈价须高于现价' };
        if (p.side === 'sell' && order.tp >= mid) return { ok: false, msg: '做空止盈价须低于现价' };
      }

      const need = Account.marginOf(order);
      if (need > this.freeMargin + 1e-9) {
        return { ok: false, msg: '可用保证金不足' };
      }

      this.orders.push(order);
      return { ok: true, order };
    }

    /**
     * 用某个品种的最新价刷新持仓（只处理该品种），触发 SL / TP
     * @param {Market} market
     * @returns {Array} 本 tick 产生的成交记录
     */
    update(market) {
      const closed = [];
      const price = market.price;

      for (const o of this.orders.slice()) {
        if (o.symbol !== market.symbol) continue;
        o.mark = price;
        // 用不利于己方的报价判断是否触发，更贴近真实
        const triggerPrice = o.side === 'buy' ? market.bid : market.ask;

        let reason = null;
        if (o.sl !== null) {
          if (o.side === 'buy' && triggerPrice <= o.sl) reason = 'SL';
          if (o.side === 'sell' && triggerPrice >= o.sl) reason = 'SL';
        }
        if (!reason && o.tp !== null) {
          if (o.side === 'buy' && triggerPrice >= o.tp) reason = 'TP';
          if (o.side === 'sell' && triggerPrice <= o.tp) reason = 'TP';
        }
        if (reason) {
          // 保证止损/止盈按设定价成交：跳空时不允许无限滑点，
          // 否则玩家「设了止损仍巨亏」，会彻底摧毁对系统的信任
          const exitPrice = reason === 'SL' ? o.sl : o.tp;
          closed.push(this.close(o.id, exitPrice, reason));
        }
      }

      if (this.equity > this.peakEquity) this.peakEquity = this.equity;
      return closed;
    }

    /**
     * 强制平仓检查：保证金率击穿阈值时，从亏损最大的单开始砍
     * @param {(symbol:string)=>Market} marketOf
     */
    stopOut(marketOf) {
      const closed = [];
      if (!this.orders.length) return closed;

      if (this.marginLevel < RULES.stopOutLevel) {
        const sorted = this.orders
          .slice()
          .sort((a, b) => Account.pnlOf(a, a.mark) - Account.pnlOf(b, b.mark));
        for (const o of sorted) {
          if (this.marginLevel >= RULES.stopOutLevel) break;
          const m = marketOf(o.symbol);
          if (!m) continue;
          closed.push(this.close(o.id, o.side === 'buy' ? m.bid : m.ask, 'STOPOUT'));
        }
      }

      if (this.balance <= 0 && this.orders.length === 0) this.blown = true;
      return closed;
    }

    /** 隔夜利息：在跨越 00:00 时结算 */
    applySwap() {
      for (const o of this.orders) {
        const rate = o.side === 'buy' ? COSTS.swapLongPerDay : COSTS.swapShortPerDay;
        // 利息按账户货币计的名义价值收取，同样要处理 inverse 品种
        const amount = Account.notionalOf(o) * rate;
        o.swap += amount;
        this.balance += amount;
      }
    }

    close(id, price, reason) {
      const i = this.orders.findIndex((o) => o.id === id);
      if (i < 0) return null;
      const o = this.orders[i];
      this.orders.splice(i, 1);

      const pnl = Account.pnlOf(o, price);
      this.balance += pnl;

      const rec = {
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        lots: o.lots,
        entry: o.entry,
        exit: price,
        pnl,
        swap: o.swap,
        reason: reason || 'MANUAL',
        at: Date.now()
      };
      this.history.unshift(rec);
      if (this.history.length > 100) this.history.pop();
      return rec;
    }

    closeAll(price, reason) {
      const out = [];
      for (const o of this.orders.slice()) out.push(this.close(o.id, price, reason));
      return out;
    }
  }

  global.FXAccount = Account;
  global.FXAccount.resumeOrderId = resumeOrderId;
})(window);
