/* 装配层：状态管理、主循环、UI 绑定 */
(function () {
  'use strict';

  const C = window.FXConfig;
  const $ = (s) => document.querySelector(s);
  const fmt = (v, d) => (isFinite(v) ? v.toFixed(d) : '—');
  const money = (v) => (isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) : '—');

  const DEFAULT_SYMBOL = Object.keys(C.INSTRUMENTS)[0]; // 跟随配置里的第一个品种

  const state = {
    symbol: DEFAULT_SYMBOL,
    tf: 'M1',
    speed: 1,
    seed: null,
    markets: {},
    account: null,
    lastSide: 'buy',
    stats: { trades: 0, wins: 0, realized: 0 },
    baseline: C.RULES.startBalance, // 表情档位的基准本金，每游戏交易日重锚
    ticksSinceRebase: 0
  };

  /* ---------------- 存档 ---------------- */

  const SAVE_INTERVAL = 5000; // 常规节流间隔；关键操作会强制落盘
  let lastSaveAt = 0;
  let saveEnabled = true;

  function snapshot() {
    const a = state.account;
    const markets = {};
    for (const s of Object.keys(state.markets)) markets[s] = state.markets[s].serialize();
    return {
      seed: state.seed,
      ui: {
        symbol: state.symbol,
        tf: state.tf,
        leverage: a.leverage,
        lots: $('#fLots').value,
        speed: state.speed,
        quickSL: $('#qSL').value,
        quickTP: $('#qTP').value
      },
      account: {
        balance: a.balance,
        peakEquity: a.peakEquity,
        blown: a.blown,
        leverage: a.leverage,
        orders: a.orders,
        history: a.history.slice(0, 30)
      },
      stats: state.stats,
      baseline: state.baseline,
      ticksSinceRebase: state.ticksSinceRebase,
      markets
    };
  }

  /** @param {boolean} force 跳过节流立即保存（下单/平仓/退出等关键节点） */
  function persist(force) {
    if (!saveEnabled) return;
    const now = Date.now();
    if (!force && now - lastSaveAt < SAVE_INTERVAL) return;
    lastSaveAt = now;

    if (window.FXSave.save(snapshot())) {
      const d = new Date();
      $('#stSaved').textContent =
        `已保存 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } else {
      saveEnabled = false;
      $('#stSaved').textContent = '存档不可用';
    }
  }

  function restore(d) {
    const acc = d.account || {};
    const a = new window.FXAccount(acc.balance);
    a.peakEquity = isFinite(acc.peakEquity) ? acc.peakEquity : acc.balance;
    a.blown = !!acc.blown;
    a.leverage = fitLeverage(acc.leverage);
    // 过滤掉已下架品种的残留数据，否则后续计算会拿到 undefined 合约参数
    a.orders = (acc.orders || []).filter((o) => o && o.symbol && C.INSTRUMENTS[o.symbol]);
    a.history = (acc.history || []).filter((r) => r && r.symbol);
    window.FXAccount.resumeOrderId(a.orders);
    state.account = a;

    state.seed = d.seed;
    state.markets = {};
    for (const s of Object.keys(d.markets || {})) {
      if (!C.INSTRUMENTS[s]) continue;
      marketOf(s).restoreState(d.markets[s]); // 行情按种子重放，精确还原价格与剧情进度
    }

    const ui = d.ui || {};
    state.symbol = C.INSTRUMENTS[ui.symbol] ? ui.symbol : DEFAULT_SYMBOL;
    marketOf(state.symbol);
    for (const o of a.orders) o.mark = marketOf(o.symbol).price; // 刷新浮盈基准
    state.tf = C.TIMEFRAMES.indexOf(ui.tf) >= 0 ? ui.tf : 'M1';
    state.speed = typeof ui.speed === 'number' ? ui.speed : 1;
    state.stats = d.stats || { trades: 0, wins: 0, realized: 0 };
    state.baseline = isFinite(d.baseline) && d.baseline > 0 ? d.baseline : C.RULES.startBalance;
    state.ticksSinceRebase = d.ticksSinceRebase || 0;

    $('#fLots').value = ui.lots || '0.10';
    $('#fLev').value = String(a.leverage);
    $('#qSL').value = ui.quickSL || '20';
    $('#qTP').value = ui.quickTP || '30';
    $('#stSeed').textContent = state.seed;
    $('#spdBox').querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', +b.dataset.speed === state.speed);
    });
    $('#notice').classList.toggle('show', state.speed === 0);

    $('#stSaved').textContent = '已恢复存档';
    renderAll(true);
    toast(`已恢复上次进度 · 余额 ${a.balance.toFixed(2)}` + (a.orders.length ? ` · ${a.orders.length} 笔持仓` : ''), 'ok');
  }

  /** 把任意杠杆值归入最近的可用档位，避免存档里的旧值让下拉框变空 */
  function fitLeverage(v) {
    const list = C.LEVERAGES;
    if (!isFinite(v)) return C.RULES.defaultLeverage;
    if (list.indexOf(v) >= 0) return v;
    return list.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), list[0]);
  }

  function renderStats() {
    const s = state.stats;
    const el = $('#stStats');
    if (!el) return;
    const rate = s.trades ? Math.round((s.wins / s.trades) * 100) : 0;
    el.textContent = s.trades ? `胜率 ${rate}% · ${money(s.realized)}` : '—';
  }

  let chart = null;

  /* ---------------- 立绘表情 ---------------- */

  // 档位逻辑在 mood.js（纯函数，可单测）；这里只负责取当前净值对应的档
  const MOOD = window.FXMood;
  MOOD.MOODS.forEach((m) => { new Image().src = MOOD.srcOf(m.file); }); // 预加载防闪烁

  let mascotFlash = null; // {frame, until} 平仓等事件触发的短暂表情

  function moodFrame() {
    const a = state.account;
    return MOOD.frameOf(a.equity, state.baseline, C.RULES.startBalance);
  }

  /**
   * 设置立绘表情。flashMs 传值时先短暂展示 frame（平仓反馈），
   * 之后回落到由浮盈决定的常驻表情
   */
  function setMascot(frame, flashMs) {
    const el = $('#mascotSprite');
    if (el == null) return;

    if (flashMs) {
      mascotFlash = { frame, until: Date.now() + flashMs };
      el.classList.remove('flash');
      void el.offsetWidth; // 强制 reflow 重启弹跳动画
      el.classList.add('flash');
    }
    if (mascotFlash && Date.now() >= mascotFlash.until) mascotFlash = null;

    const f = mascotFlash ? mascotFlash.frame : moodFrame();
    if (el.dataset.frame !== String(f)) {
      el.dataset.frame = String(f);
      el.src = MOOD.srcOf(MOOD.MOODS[f].file);
      $('#mascotMood').textContent = MOOD.MOODS[f].name;
    }

    const a = state.account;
    const pct = ((a.equity - state.baseline) / Math.max(1, state.baseline)) * 100;
    $('#mascot').title =
      `净值 ${a.equity.toFixed(2)} · 基准 ${state.baseline.toFixed(2)} · ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  /* ---------------- 生命周期 ---------------- */

  function marketOf(symbol) {
    if (!state.markets[symbol]) {
      state.markets[symbol] = new window.FXMarket(symbol, state.seed);
    }
    return state.markets[symbol];
  }

  function newGame(seed) {
    state.seed = seed != null ? seed : Math.floor(Math.random() * 1e9);
    state.markets = {};
    state.account = new window.FXAccount(C.RULES.startBalance);
    state.stats = { trades: 0, wins: 0, realized: 0 };
    state.baseline = C.RULES.startBalance;
    state.ticksSinceRebase = 0;
    marketOf(state.symbol);
    $('#stSeed').textContent = state.seed;
    $('#modal').classList.add('hide');
    renderAll(true);
    persist(true); // 新局立即覆盖旧存档
  }

  /* ---------------- 主循环 ---------------- */

  function step() {
    const acct = state.account;
    let dayPassed = false;
    const closed = [];

    for (const sym of Object.keys(state.markets)) {
      const m = state.markets[sym];
      const fired = m.tick() || {};
      if (fired.event) onEvent(fired.event);
      if (fired.story) onStory(fired.story);
      if (m.newDay) dayPassed = true;
      closed.push.apply(closed, acct.update(m));
    }
    if (dayPassed) acct.applySwap();

    closed.push.apply(closed, acct.stopOut(marketOf));
    onClosed(closed);

    // 每个游戏交易日重锚一次基准本金：本金随盈利一起长大，
    // 档位就始终相对「近期水平」而非永远盯着开局那 1000 块
    state.ticksSinceRebase += 1;
    if (state.ticksSinceRebase >= C.MASCOT.rebaseTicks) {
      state.ticksSinceRebase = 0;
      state.baseline = Math.max(1, acct.equity);
      toast(`新交易日 · 本金基准重置为 ${state.baseline.toFixed(2)}`, 'ok');
    }

    persist(); // 常规节流保存，保证行情推进也能被记住

    // 订单可能由 SL/TP 平掉（不在 stopOut 内），爆仓判定必须在此统一做。
    // 强平保护让余额很难归零，因此再补一条资金枯竭判定，否则本局永远不会结束
    if (acct.balance <= 0 && acct.orders.length === 0) acct.blown = true;
    if (acct.balance < C.RULES.startBalance * C.RULES.bankruptBelow) acct.blown = true;

    if (acct.blown && $('#modal').classList.contains('hide')) showBlowUp();
  }

  let acc = 0;
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (state.speed > 0 && !state.account.blown) {
      acc += (dt * 1000 * state.speed) / C.RULES.tickMs;
      let guard = 0;
      while (acc >= 1 && guard++ < 60) {
        acc -= 1;
        step();
      }
    }
    render();
    requestAnimationFrame(frame);
  }

  /* ---------------- 反馈 ---------------- */

  let toastTimer = null;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = ''), 1800);
  }

  function onEvent(ev) {
    toast(`📰 ${ev.name} · ${ev.dir === 'up' ? '跳涨' : '跳跌'}`, 'ok');
  }

  function onStory(s) {
    toast(`📺 《FX战士》第 ${s.episode} 集「${s.title}」播出 · 日元短线走强`, 'ok');
  }

  function onClosed(list) {
    for (const r of list) {
      if (!r) continue;
      state.stats.trades += 1;
      if (r.pnl > 0) state.stats.wins += 1;
      state.stats.realized += r.pnl;
      const label = { SL: '止损', TP: '止盈', STOPOUT: '强制平仓', MANUAL: '手动平仓' }[r.reason] || r.reason;
      toast(`${label} ${r.symbol} ${r.side === 'buy' ? '多' : '空'} ${r.lots}手 · ${money(r.pnl)}`, r.pnl >= 0 ? 'ok' : 'err');
    }
    if (list.length) {
      // 平仓反馈：大赚欢呼、小赚开心、小亏生气、大亏痛哭
      const last = list.filter(Boolean).pop();
      if (last) {
        const big = C.RULES.startBalance * 0.02;
        const f = last.pnl >= big ? 0 : last.pnl > 0 ? 1 : last.pnl <= -big ? 6 : 4;
        setMascot(f, 2200);
      }
      renderAll(true);
      persist(true);
    }
  }

  /** 一键平仓：按市价平掉所有品种的全部持仓 */
  function closeAll() {
    const closed = [];
    for (const o of state.account.orders.slice()) {
      const mk = marketOf(o.symbol);
      closed.push(state.account.close(o.id, o.side === 'buy' ? mk.bid : mk.ask, 'MANUAL'));
    }
    if (!closed.length) {
      toast('当前没有持仓', 'err');
      return;
    }
    onClosed(closed);
  }

  function showBlowUp() {
    const a = state.account;
    setMascot(6, 8000);
    $('#modalTitle').textContent = '账户已清算';
    $('#modalBody').innerHTML =
      `最终余额 <b>${a.balance.toFixed(2)}</b><br>` +
      `净值峰值 <b>${a.peakEquity.toFixed(2)}</b><br>` +
      `累计成交 <b>${a.history.length}</b> 笔<br>` +
      `起点资金 <b>${C.RULES.startBalance}</b>`;
    $('#modal').classList.remove('hide');
    persist(true);
  }

  /* ---------------- 渲染 ---------------- */

  let posSig = '';
  let hisSig = '';

  function renderAll(force) {
    // 用 null 触发强制重建：持仓清空时 sig 会变回空串，
    // 若这里也置空串就会命中缓存、UI 停留在旧状态
    posSig = null;
    hisSig = null;
    buildTabs();
    renderStats();
    render(force);
  }

  function buildTabs() {
    const symTabs = $('#symTabs');
    symTabs.innerHTML = '';
    Object.keys(C.INSTRUMENTS).forEach((s) => {
      const b = document.createElement('button');
      b.textContent = s;
      b.className = s === state.symbol ? 'on' : '';
      b.onclick = () => {
        state.symbol = s;
        marketOf(s);
        // 切换品种必须清空 SL/TP：不同品种价位量级完全不同，
        // 残留旧值会导致开仓即成交的巨额亏损
        $('#fSL').value = '';
        $('#fTP').value = '';
        chart.reset();
        buildTabs();
        renderAll(true);
      };
      symTabs.appendChild(b);
    });

    const tfTabs = $('#tfTabs');
    tfTabs.innerHTML = '';
    C.TIMEFRAMES.forEach((t) => {
      const b = document.createElement('button');
      b.textContent = t;
      b.className = t === state.tf ? 'on' : '';
      b.onclick = () => {
        state.tf = t;
        buildTabs();
      };
      tfTabs.appendChild(b);
    });

    syncPriceStep();
  }

  /**
   * 止损/止盈输入框的滚轮步进跟随品种。
   * 默认写在 HTML 里的 0.01 正好是 USDJPY 的 1 pip；换到 EURUSD 这类五位小数品种时
   * 若仍是 0.01，滚一格就是 90 多 pip，所以按各品种的 pip 自动适配。
   * 想让所有品种都固定 0.01，把下面赋成 0.01 即可。
   */
  function syncPriceStep() {
    const inst = C.INSTRUMENTS[state.symbol];
    const step = inst && inst.pip ? inst.pip : 0.01;
    $('#fSL').step = String(step);
    $('#fTP').step = String(step);
  }

  function render() {
    const m = marketOf(state.symbol);
    const a = state.account;
    const d = m.inst.digits;

    /* 报价 */
    $('#stBid').textContent = fmt(m.bid, d);
    $('#stAsk').textContent = fmt(m.ask, d);
    $('#buyPx').textContent = fmt(m.ask, d);
    $('#sellPx').textContent = fmt(m.bid, d);

    const vol = m.volState;
    $('#stVol').textContent = `波动 · ${vol.name}${m.event ? ' ⚡' : ''}`;
    $('#stVol').className = 'vol' + (vol.mult >= 1.9 ? ' active' : '');

    const evEl = $('#stEvent');
    if (m.event) {
      evEl.textContent = `⚡ ${m.event.name} · 高波动持续中`;
      evEl.className = 'event hot';
    } else {
      evEl.textContent = '市场平静';
      evEl.className = 'event';
    }

    /* 账户 */
    const eq = a.equity;
    const pnl = a.floating;
    const ml = a.marginLevel;
    $('#stBalance').textContent = a.balance.toFixed(2);
    $('#stEquity').textContent = eq.toFixed(2);
    $('#stEquity').className = eq >= C.RULES.startBalance ? 'up' : 'down';

    const pnlEl = $('#stPnl');
    pnlEl.textContent = money(pnl);
    pnlEl.className = pnl > 0 ? 'up' : pnl < 0 ? 'down' : '';

    $('#stMargin').textContent = a.usedMargin.toFixed(2);
    const mlEl = $('#stMl');
    mlEl.textContent = a.orders.length ? ml.toFixed(0) + '%' : '—';
    mlEl.className = !a.orders.length ? '' : ml < C.RULES.stopOutLevel + 30 ? 'warn' : ml < C.RULES.marginCallLevel ? 'down' : 'up';

    $('#stClock').textContent = m.clockLabel();

    /* 下单提示 */
    const inst = m.inst;
    const lots = parseFloat($('#fLots').value) || 0;
    const lev = parseInt($('#fLev').value, 10) || 1;
    const notional = inst.inverse ? lots * inst.contractSize : m.ask * lots * inst.contractSize;
    const need = notional / lev;
    const spreadCost = (inst.spread * lots * inst.contractSize) / (inst.inverse ? m.price : 1);
    $('#fInfo').textContent = `所需保证金 ≈ ${need.toFixed(2)} · 点差成本 ≈ ${spreadCost.toFixed(2)}`;

    /* 持仓 */
    const sig = a.orders.map((o) => o.id + ':' + o.mark).join('|');
    if (sig !== posSig) {
      posSig = sig;
      renderPositions(d);
    }
    const hsig = a.history.length + ':' + (a.history[0] ? a.history[0].id : 0);
    if (hsig !== hisSig) {
      hisSig = hsig;
      renderHistory(d);
    }

    /* 图表 */
    chart.draw(m.getCandles(state.tf), {
      digits: d,
      ask: m.ask,
      orders: a.orders
        .filter((o) => o.symbol === state.symbol)
        .map((o) => ({ entry: o.entry, sl: o.sl, tp: o.tp, side: o.side }))
    });

    setMascot();
  }

  function renderPositions(d) {
    const a = state.account;
    const box = $('#posList');
    $('#posCount').textContent = a.orders.length;
    const btnAll = $('#btnCloseAll');
    btnAll.hidden = !a.orders.length;
    if (a.orders.length) btnAll.innerHTML = `一键平仓 <em>${money(a.floating)}</em>`;
    if (!a.orders.length) {
      box.innerHTML = '<div class="empty">暂无持仓</div>';
      return;
    }
    box.innerHTML = '';
    for (const o of a.orders) {
      // 每个品种小数位不同，必须按订单自身品种格式化，不能统一用当前品种的
      const od = C.INSTRUMENTS[o.symbol].digits;
      const p = window.FXAccount.pnlOf(o, o.mark);
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML =
        `<div class="l1">` +
        `<span class="sym ${o.side}">${o.symbol} ${o.side === 'buy' ? '多' : '空'} ${o.lots}</span>` +
        `<span class="pnl ${p >= 0 ? 'up' : 'down'}">${money(p)}</span>` +
        `</div>` +
        `<div class="l2"><span>开 ${o.entry.toFixed(od)} → 现 ${o.mark.toFixed(od)}</span>` +
        `<button class="x" data-close="${o.id}">平仓</button></div>` +
        `<div class="l2"><span>SL ${o.sl === null ? '—' : o.sl.toFixed(od)} · TP ${o.tp === null ? '—' : o.tp.toFixed(od)} · ${o.leverage}x</span></div>`;
      box.appendChild(el);
    }
    box.querySelectorAll('[data-close]').forEach((b) => {
      b.onclick = () => {
        const m = marketOf(state.account.orders.find((o) => o.id === +b.dataset.close).symbol);
        const o = state.account.orders.find((x) => x.id === +b.dataset.close);
        const r = state.account.close(o.id, o.side === 'buy' ? m.bid : m.ask, 'MANUAL');
        onClosed([r]);
      };
    });
  }

  function renderHistory(d) {
    const a = state.account;
    const box = $('#hisList');
    $('#hisCount').textContent = a.history.length;
    if (!a.history.length) {
      box.innerHTML = '<div class="empty">还没有成交记录</div>';
      return;
    }
    box.innerHTML = '';
    for (const r of a.history.slice(0, 30)) {
      const rd = C.INSTRUMENTS[r.symbol].digits;
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML =
        `<div class="l1"><span class="sym ${r.side}">${r.symbol} ${r.side === 'buy' ? '多' : '空'} ${r.lots}</span>` +
        `<span class="pnl ${r.pnl >= 0 ? 'up' : 'down'}">${money(r.pnl)}</span></div>` +
        `<div class="l2"><span>${r.entry.toFixed(rd)} → ${r.exit.toFixed(rd)}</span>` +
        `<span class="reason ${r.reason}">${r.reason}</span></div>`;
      box.appendChild(el);
    }
  }

  /* ---------------- 交互 ---------------- */

  function placeOrder(side) {
    const m = marketOf(state.symbol);
    const inst = m.inst;
    const lots = parseFloat($('#fLots').value);
    const lev = parseInt($('#fLev').value, 10);
    const slRaw = parseFloat($('#fSL').value);
    const tpRaw = parseFloat($('#fTP').value);

    state.lastSide = side;
    const res = state.account.open({
      symbol: state.symbol,
      side,
      lots,
      price: m.price,
      sl: isFinite(slRaw) ? slRaw : null,
      tp: isFinite(tpRaw) ? tpRaw : null,
      leverage: lev,
      tick: m.tickIndex
    });

    if (!res.ok) return toast(res.msg, 'err');
    const word = side === 'buy' ? '做多' : '做空';
    // 同品种已有反向持仓 => 多空并存形成锁仓（双边占用保证金），必须让玩家知情
    const hedged = state.account.orders.some((o) => o.symbol === state.symbol && o.side !== side);
    toast(`${word} ${lots} 手 @ ${res.order.entry.toFixed(inst.digits)}` + (hedged ? ' · 与反向持仓锁仓' : ''), 'ok');
    renderAll(true);
    persist(true);

    // 竖屏下单面板与持仓不在一屏内，下单后直接带到持仓区，方便立刻管止损
    if (window.matchMedia('(max-width: 860px)').matches) {
      const panel = $('#posList').closest('.panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function bindUI() {
    /* 杠杆下拉 */
    const lev = $('#fLev');
    lev.title = '真实券商为固定档位，不可任意填写。参考监管上限：日本 25:1 · 美国 50:1 · 欧盟 30:1 · 离岸 500:1+';
    C.LEVERAGES.forEach((l) => {
      const op = document.createElement('option');
      op.value = l;
      op.textContent = l + 'x';
      if (l === C.RULES.defaultLeverage) op.selected = true;
      lev.appendChild(op);
    });

    $('#btnBuy').onclick = () => placeOrder('buy');
    $('#btnSell').onclick = () => placeOrder('sell');

    /* 倍速 */
    $('#spdBox').querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        state.speed = +b.dataset.speed;
        $('#spdBox').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        $('#notice').classList.toggle('show', state.speed === 0);
      };
    });

    /* SL / TP 距离可自行设置（单位 pip），按当前方向套用到现价 */
    function quickDist() {
      const m = marketOf(state.symbol);
      return {
        pip: m.inst.pip,
        digits: m.inst.digits,
        price: m.price,
        sl: Math.max(1, parseFloat($('#qSL').value) || 20),
        tp: Math.max(1, parseFloat($('#qTP').value) || 30),
        buy: state.lastSide === 'buy'
      };
    }
    $('#btnSL').onclick = () => {
      const q = quickDist();
      $('#fSL').value = (q.price + (q.buy ? -q.sl : q.sl) * q.pip).toFixed(q.digits);
    };
    $('#btnTP').onclick = () => {
      const q = quickDist();
      $('#fTP').value = (q.price + (q.buy ? q.tp : -q.tp) * q.pip).toFixed(q.digits);
    };
    $('#btnClear').onclick = () => {
      $('#fSL').value = '';
      $('#fTP').value = '';
    };

    $('#btnRestart').onclick = () => newGame();
    $('#btnReroll').onclick = () => newGame();

    $('#btnCloseAll').onclick = closeAll;

    /* 键盘 */
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (k === 'b') placeOrder('buy');
      else if (k === 's') placeOrder('sell');
      else if (k === 'escape') closeAll();
      else if (k === ' ') {
        e.preventDefault();
        const btns = $('#spdBox').querySelectorAll('button');
        const target = state.speed === 0 ? 1 : 0;
        btns.forEach((x) => {
          if (+x.dataset.speed === target) x.click();
        });
      } else if (/^[1-6]$/.test(k)) {
        state.tf = C.TIMEFRAMES[+k - 1];
        buildTabs();
      }
    });

    /* 图表交互 */
    const cv = $('#chart');
    $('#zoomIn').onclick = () => chart.zoom(-12);
    $('#zoomOut').onclick = () => chart.zoom(12);
    $('#zoomReset').onclick = () => chart.reset();

    // 竖屏整页不滚、只有下方交易区滚，所以图表上的滚轮也代理到该区，
    // 否则在图表上滚会毫无反应。需要缩放时用 Ctrl + 滚轮或左上角按钮
    const sideEl = $('#side');
    cv.addEventListener('wheel', (e) => {
      const narrow = window.matchMedia('(max-width: 860px)').matches;
      if (narrow && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        sideEl.scrollTop += e.deltaY;
        return;
      }
      e.preventDefault();
      chart.zoom(e.deltaY > 0 ? 12 : -12);
    }, { passive: false });

    let dragging = false;
    let dragX = 0;
    cv.addEventListener('mousedown', (e) => {
      dragging = true;
      dragX = e.clientX;
    });
    window.addEventListener('mouseup', () => (dragging = false));
    // 触摸设备不画十字光标：手指一按就触发，会盖住 K 线且无处「移出」
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    cv.addEventListener('mousemove', (e) => {
      const r = cv.getBoundingClientRect();
      if (!coarse) chart.crosshair = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (dragging) {
        const dx = e.clientX - dragX;
        if (Math.abs(dx) > 4) {
          chart.pan(Math.round(dx / 6));
          dragX = e.clientX;
        }
      }
    });
    cv.addEventListener('mouseleave', () => (chart.crosshair = null));

    // 离开页面 / 切到后台时强制落盘，避免最后几秒的操作丢失
    window.addEventListener('beforeunload', () => persist(true));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) persist(true);
    });
  }

  /* ---------------- 启动 ---------------- */

  chart = new window.FXChart($('#chart'));
  bindUI();

  const saved = window.FXSave.load();
  if (saved) restore(saved);
  else newGame();

  requestAnimationFrame(frame);
})();
