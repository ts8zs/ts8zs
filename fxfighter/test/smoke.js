/* 引擎冒烟测试：node test/smoke.js */
global.window = global;
require('../src/rng.js');
require('../src/config.js');
require('../src/market.js');
require('../src/account.js');

const C = global.FXConfig;
const { FXMarket, FXAccount, FXRng } = global;

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
}
function near(a, b, eps) {
  return Math.abs(a - b) < (eps || 1e-6);
}

console.log('\n[1] 行情确定性');
{
  const m1 = new FXMarket('EURUSD', 12345);
  const m2 = new FXMarket('EURUSD', 12345);
  let same = true;
  for (let i = 0; i < 200; i++) {
    m1.tick();
    m2.tick();
    if (m1.price !== m2.price) same = false;
  }
  ok('同种子行情完全一致', same);

  const m3 = new FXMarket('EURUSD', 999);
  for (let i = 0; i < 200; i++) m3.tick();
  ok('不同种子行情不同', Math.abs(m3.price - m1.price) > 1e-9);
  ok('价格保持正数且有限', m1.price > 0 && isFinite(m1.price), 'price=' + m1.price);
}

console.log('\n[2] K 线聚合');
{
  const m = new FXMarket('EURUSD', 7);
  const before = m.getCandles('M1').length;
  for (let i = 0; i < 120; i++) m.tick();
  const c1 = m.getCandles('M1');
  const h1 = m.getCandles('H1');
  ok('M1 增长 120 根', c1.length - before === 120 || c1.length === 600, `${before} -> ${c1.length}`);
  ok('H1 数量为 M1 的约 1/60', Math.abs(h1.length * 60 - c1.length) < 60, `M1=${c1.length} H1=${h1.length}`);
  const last = c1[c1.length - 1];
  ok('OHLC 关系成立 h>=max(o,c), l<=min(o,c)',
    last.h >= Math.max(last.o, last.c) - 1e-12 && last.l <= Math.min(last.o, last.c) + 1e-12);
}

console.log('\n[3] 盈亏与保证金');
{
  const a = new FXAccount(1000);
  const m = new FXMarket('EURUSD', 42);
  const res = a.open({ symbol: 'EURUSD', side: 'buy', lots: 0.1, price: m.price, sl: null, tp: null, leverage: 100 });
  ok('开仓成功', res.ok, res.msg);
  ok('买入价含半点差', near(res.order.entry, m.price + m.inst.spread / 2));

  const margin = FXAccount.marginOf(res.order);
  ok('保证金 = 合约价值/杠杆', near(margin, (res.order.entry * 0.1 * 100000) / 100, 1e-6), margin.toFixed(2));

  // 上涨 100 pip（0.0100）=> 0.1 手应赚 $100
  const up = res.order.entry + 0.01;
  ok('0.1 手上行 100pip 盈利 $100', near(FXAccount.pnlOf(res.order, up), 100, 1e-6),
    FXAccount.pnlOf(res.order, up).toFixed(2));
  const down = res.order.entry - 0.01;
  ok('同幅度下行亏损 $100', near(FXAccount.pnlOf(res.order, down), -100, 1e-6));

  const sell = a.open({ symbol: 'EURUSD', side: 'sell', lots: 0.1, price: m.price, sl: null, tp: null, leverage: 100 });
  ok('做空方向相反', FXAccount.pnlOf(sell.order, down) > 0);
}

console.log('\n[4] 保证金不足拦截');
{
  const a = new FXAccount(1000);
  const m = new FXMarket('EURUSD', 5);
  const bad = a.open({ symbol: 'EURUSD', side: 'buy', lots: 40, price: m.price, sl: null, tp: null, leverage: 10 });
  ok('超大仓位被拒绝', !bad.ok, bad.msg);
}

console.log('\n[5] 止损 / 止盈触发');
{
  const a = new FXAccount(1000);
  const m = new FXMarket('EURUSD', 88);
  const px = m.price;
  const o = a.open({ symbol: 'EURUSD', side: 'buy', lots: 0.1, price: px, sl: px - 0.0010, tp: px + 0.0020, leverage: 100 });
  ok('带 SL/TP 开仓成功', o.ok);

  m.price = px - 0.0020; // 击穿 SL
  let closed = a.update(m);
  ok('SL 触发并平仓', closed.length === 1 && closed[0].reason === 'SL', JSON.stringify(closed[0] && closed[0].reason));
  ok('SL 成交为亏损', closed[0].pnl < 0, closed[0].pnl.toFixed(2));
  ok('余额已结算', near(a.balance, 1000 + closed[0].pnl, 1e-9));

  const o2 = a.open({ symbol: 'EURUSD', side: 'buy', lots: 0.1, price: px, sl: px - 0.0010, tp: px + 0.0020, leverage: 100 });
  m.price = px + 0.0030; // 击穿 TP
  closed = a.update(m);
  ok('TP 触发并平仓', closed.length === 1 && closed[0].reason === 'TP');
  ok('TP 成交为盈利', closed[0].pnl > 0);
}

console.log('\n[6] 强制平仓');
{
  const a = new FXAccount(1000);
  const m = new FXMarket('EURUSD', 3);
  const px = m.price;
  a.open({ symbol: 'EURUSD', side: 'buy', lots: 4, price: px, sl: null, tp: null, leverage: 500 });
  ok('高杠杆大仓位可开', a.orders.length === 1);
  ok('初始保证金率 > 100%', a.marginLevel > 100, a.marginLevel.toFixed(1) + '%');

  // 持续下跌，直到击穿强平线
  let stopout = null;
  for (let i = 0; i < 200 && !stopout; i++) {
    m.price = px * (1 - 0.0002 * i);
    a.update(m);
    const c = a.stopOut(() => m);
    if (c.length) stopout = c[0];
  }
  ok('触发强制平仓', !!stopout && stopout.reason === 'STOPOUT', stopout ? stopout.reason : '未触发');
  ok('强平后无持仓', a.orders.length === 0);
  ok('账户未穿仓到负净值', a.balance > -1, 'balance=' + a.balance.toFixed(2));
}

console.log('\n[7] 隔夜利息');
{
  const a = new FXAccount(1000);
  const m = new FXMarket('EURUSD', 11);
  const r = a.open({ symbol: 'EURUSD', side: 'buy', lots: 0.5, price: m.price, sl: null, tp: null, leverage: 100 });
  ok('隔夜利息用例建仓成功', r.ok, r.msg);
  const before = a.balance;
  a.applySwap();
  ok('多头隔夜利息为支出', a.balance < before, `${before} -> ${a.balance.toFixed(4)}`);
  const expect = r.order.entry * 0.5 * 100000 * C.COSTS.swapLongPerDay;
  ok('利息金额与配置一致', near(a.balance - before, expect, 1e-9), (a.balance - before).toFixed(4));
}

console.log('\n[8] 长时间运行的稳定性');
{
  const m = new FXMarket('BTCUSD', 2024);
  let bad = 0;
  for (let i = 0; i < 5000; i++) {
    m.tick();
    if (!isFinite(m.price) || m.price <= 0) bad++;
  }
  ok('5000 tick 无异常价格', bad === 0, 'bad=' + bad);
  ok('价格仍在合理区间', m.price > 1000 && m.price < 5e6, m.price.toFixed(2));
  const rng = FXRng.makeRng(1);
  let s = 0;
  for (let i = 0; i < 20000; i++) s += rng.gauss();
  ok('高斯分布均值接近 0', Math.abs(s / 20000) < 0.05, (s / 20000).toFixed(4));
}

console.log('\n[9] 跳空保护：止损按设定价成交');
{
  const a = new FXAccount(1000);
  const m = new FXMarket('EURUSD', 77);
  const px = m.price;
  const dist = 0.0020; // 20 pip
  const o = a.open({ symbol: 'EURUSD', side: 'buy', lots: 0.1, price: px, sl: px - dist, tp: px + 0.0030, leverage: 100 });

  m.price = px * (1 - 0.012); // 模拟极端跳空，远超止损距离
  const closed = a.update(m);
  ok('跳空仍触发止损', closed.length === 1 && closed[0].reason === 'SL');
  ok('成交价等于止损价（无无限滑点）', near(closed[0].exit, o.order.sl, 1e-12), closed[0].exit.toFixed(5));
  // 亏损上限 = (止损距离 + 半点差) × 手数 × 合约大小
  const worst = (dist + m.inst.spread / 2) * 0.1 * 100000;
  ok('亏损不超过止损距离对应金额', Math.abs(closed[0].pnl) <= worst + 1e-6,
    `${closed[0].pnl.toFixed(2)} vs ${worst.toFixed(2)}`);
}

console.log('\n[10] 事件跳空幅度可控');
{
  // 跳空幅度按品种 sigmaTick 缩放，所以用相对上限而非固定百分比
  for (const sym of ['EURUSD', 'BTCUSD']) {
    const m = new FXMarket(sym, 2026);
    let prev = m.price;
    let maxMove = 0;
    for (let i = 0; i < 8000; i++) {
      m.tick();
      const r = Math.abs(m.price / prev - 1);
      if (r > maxMove) maxMove = r;
      prev = m.price;
    }
    const cap = C.INSTRUMENTS[sym].sigmaTick * 45;
    ok(`${sym} 单 tick 波动受控（< sigmaTick×45）`, maxMove < cap,
      `${(maxMove * 100).toFixed(2)}% vs 上限 ${(cap * 100).toFixed(2)}%`);
  }
}

console.log('\n[11] SL/TP 方向校验（防跨品种残留价格）');
{
  const a = new FXAccount(1000);
  const m = new FXMarket('BTCUSD', 5);
  const px = m.price;

  // 模拟：从 EURUSD 切到 BTCUSD 后，残留了 1.08x 的 SL/TP
  const badSl = a.open({ symbol: 'BTCUSD', side: 'buy', lots: 0.1, price: px, sl: px + 100, tp: null, leverage: 100 });
  ok('买入时止损高于现价被拒绝', !badSl.ok, badSl.msg);

  const badTp2 = a.open({ symbol: 'BTCUSD', side: 'buy', lots: 0.1, price: px, sl: null, tp: 1.08772, leverage: 100 });
  ok('买入时止盈低于现价被拒绝', !badTp2.ok, badTp2.msg);

  const badSlSell = a.open({ symbol: 'BTCUSD', side: 'sell', lots: 0.1, price: px, sl: px - 100, tp: null, leverage: 100 });
  ok('卖出时止损低于现价被拒绝', !badSlSell.ok, badSlSell.msg);

  const good = a.open({ symbol: 'BTCUSD', side: 'buy', lots: 0.1, price: px, sl: px - 500, tp: px + 800, leverage: 100 });
  ok('方向正确的 SL/TP 可开仓', good.ok, good.msg);
}

console.log('\n[12] 间接报价品种（USDJPY）的保证金');
{
  const a = new FXAccount(1000);
  const m = new FXMarket('USDJPY', 21);
  const r = a.open({ symbol: 'USDJPY', side: 'buy', lots: 0.1, price: m.price, sl: null, tp: null, leverage: 100 });
  ok('USDJPY 0.1 手可开仓', r.ok, r.msg);

  const mg = FXAccount.marginOf(r.order);
  // 1 手 USDJPY = 100,000 USD（基础货币就是 USD），0.1 手 = 10,000 USD
  ok('保证金 = 10,000 USD / 100 = 100', near(mg, 100, 1e-6), mg.toFixed(2));
  ok('不再因乘价格而虚高（旧值约 14,950）', mg < 200, mg.toFixed(2));

  // 1 pip = 0.01 JPY；每标准手价值 = 1000 JPY ÷ 149.51 ≈ $6.69，0.1 手即 ≈ $0.669
  const onePip = FXAccount.pnlOf(r.order, r.order.entry + m.inst.pip);
  ok('0.1 手 1 pip 价值 ≈ $0.669', onePip > 0.6 && onePip < 0.7, onePip.toFixed(3));
  ok('折合每标准手 1 pip ≈ $6.69', near(onePip * 10, 1000 / (r.order.entry + m.inst.pip), 1e-6),
    (onePip * 10).toFixed(3));

  const before = a.balance;
  a.applySwap();
  ok('隔夜利息按 USD 名义值计（约 -2）', near(a.balance - before, 10000 * C.COSTS.swapLongPerDay, 1e-6),
    (a.balance - before).toFixed(4));

  // 回归：直接报价品种公式不应被改动
  const a2 = new FXAccount(1000);
  const me = new FXMarket('EURUSD', 22);
  const re = a2.open({ symbol: 'EURUSD', side: 'buy', lots: 0.1, price: me.price, sl: null, tp: null, leverage: 100 });
  ok('EURUSD 保证金公式未受影响',
    near(FXAccount.marginOf(re.order), (re.order.entry * 0.1 * 100000) / 100, 1e-6),
    FXAccount.marginOf(re.order).toFixed(2));
}

console.log('\n[13] 存档：行情重放与读写往返');
{
  const store = {};
  global.localStorage = {
    setItem: (k, v) => { store[k] = String(v); },
    getItem: (k) => (k in store ? store[k] : null),
    removeItem: (k) => { delete store[k]; }
  };
  require('../src/save.js');
  const FXSave = global.FXSave;
  ok('存储可用', FXSave.available());

  // 行情重放：连续 tick 到 N 与 fastForward 到 N 必须完全一致
  const mA = new FXMarket('EURUSD', 4242);
  for (let i = 0; i < 150; i++) mA.tick();
  const mB = new FXMarket('EURUSD', 4242);
  mB.fastForward(mA.tickIndex);
  ok('fastForward 还原同一价格', mB.price === mA.price, `${mB.price} vs ${mA.price}`);
  ok('fastForward 还原同一进度', mB.tickIndex === mA.tickIndex);
  ok('目标小于当前进度时不倒退', new FXMarket('EURUSD', 1).fastForward(10) >= 400);

  // 存档往返
  const a = new FXAccount(1000);
  const m = new FXMarket('EURUSD', 555);
  a.open({ symbol: 'EURUSD', side: 'buy', lots: 0.2, price: m.price, sl: m.price - 0.003, tp: m.price + 0.005, leverage: 100 });
  for (let i = 0; i < 50; i++) { m.tick(); a.update(m); }

  const snap = {
    seed: 555,
    ui: { symbol: 'EURUSD', tf: 'M5', leverage: 100, lots: '0.20', speed: 5 },
    account: {
      balance: a.balance, peakEquity: a.peakEquity, blown: a.blown, leverage: 100,
      orders: a.orders, history: a.history.slice(0, 30)
    },
    stats: { trades: 3, wins: 2, realized: 12.5 },
    markets: { EURUSD: { tick: m.tickIndex } }
  };
  ok('写入成功', FXSave.save(snap));

  const back = FXSave.load();
  ok('读回非空', !!back);
  ok('版本号正确', back.v === FXSave.VERSION);
  ok('余额一致', back.account.balance === snap.account.balance);
  ok('持仓完整保留', back.account.orders.length === 1 && back.account.orders[0].lots === 0.2);
  ok('止损止盈保留', back.account.orders[0].sl === snap.account.orders[0].sl);
  ok('统计保留', back.stats.trades === 3 && back.stats.realized === 12.5);
  ok('行情进度保留', back.markets.EURUSD.tick === m.tickIndex);
  ok('UI 状态保留', back.ui.tf === 'M5' && back.ui.speed === 5);

  // 异常输入必须安全降级
  store[FXSave.KEY] = JSON.stringify({ v: 999, account: { balance: 1 } });
  ok('版本不符返回 null', FXSave.load() === null);
  store[FXSave.KEY] = '{坏数据';
  ok('损坏存档返回 null', FXSave.load() === null);
  FXSave.clear();
  ok('清除后读回 null', FXSave.load() === null);

  global.localStorage = undefined;
  ok('无存储时 save 安全失败', FXSave.save({ a: 1 }) === false);
  ok('无存储时 load 返回 null', FXSave.load() === null);
}

console.log('\n[14] 表情档位：放宽阈值与方向性约束');
{
  require('../src/mood.js');
  const M = global.FXMood;
  const start = C.RULES.startBalance;
  const t = C.MASCOT.thresholds;

  ok('最小档阈值已放宽到 >= 5%', t[2] >= 5, '微赚阈值 ' + t[2] + '%');
  ok('七个档位图片齐全', M.MOODS.length === 7);

  // 基准 = 初始本金时的基本分档
  ok('+60% → 发财', M.frameOf(1600, 1000, start) === 0, String(M.frameOf(1600, 1000, start)));
  ok('+30% → 小赚', M.frameOf(1300, 1000, start) === 1);
  ok('+10% → 微赚', M.frameOf(1100, 1000, start) === 2);
  ok('  0% → 一般', M.frameOf(1000, 1000, start) === 3);
  ok('-10% → 微亏', M.frameOf(900, 1000, start) === 4);
  ok('-30% → 小亏', M.frameOf(700, 1000, start) === 5);
  ok('-60% → 大亏', M.frameOf(400, 1000, start) === 6);

  // 小波动不应跳档（旧阈值 ±3% 过于敏感）
  ok('+3% 仍属一般档，不跳档', M.frameOf(1030, 1000, start) === 3);

  // 约束一：低于初始本金必定是负面档
  // 本金重锚到 400 后，420 相对基准是 +5%（本该微赚），但低于初始本金 => 仍须负面
  const fLow = M.frameOf(420, 400, start);
  ok('低于初始本金不会给正面档', fLow >= 4, '档位 ' + fLow);

  // 约束二：高于初始本金不会触发最差档
  // 基准 3000、净值 1100 相对基准 -63%（本该大亏），但高于初始本金 => 收敛到小亏
  const fHigh = M.frameOf(1100, 3000, start);
  ok('高于初始本金不触发最差档', fHigh !== 6, '档位 ' + fHigh);
  ok('且被收敛为小亏', fHigh === 5, '档位 ' + fHigh);

  // 边界与异常输入
  ok('恰好等于初始本金为一般档', M.frameOf(start, start, start) === 3);
  ok('基准为 0 时回退到初始本金', M.frameOf(1000, 0, start) === 3);
  ok('净值归零不崩溃', isFinite(M.frameOf(0, 1000, start)) && M.frameOf(0, 1000, start) === 6);
}

console.log('\n[15] 品种顺序与波动梯度');
{
  const keys = Object.keys(C.INSTRUMENTS);
  ok('USDJPY 排在第一个', keys[0] === 'USDJPY', keys.join(','));
  ok('五个品种齐全', keys.length === 5);

  function realizedVol(sym) {
    const m = new FXMarket(sym, 31415);
    let prev = m.price;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 3000; i++) {
      m.tick();
      const r = Math.log(m.price / prev);
      prev = m.price;
      sum += r * r;
      n++;
    }
    return Math.sqrt(sum / n);
  }

  const vol = {};
  for (const sym of Object.keys(C.INSTRUMENTS)) vol[sym] = realizedVol(sym);

  ok('BTC 波动仍是 EURUSD 的 6 倍以上', vol.BTCUSD / vol.EURUSD > 6, `比值 ${(vol.BTCUSD / vol.EURUSD).toFixed(1)}`);
  ok('BTC 每 tick 波动 > 0.15%', vol.BTCUSD > 0.0015, (vol.BTCUSD * 100).toFixed(3) + '%');
  ok('EURUSD 保持外汇级别的低波动', vol.EURUSD < 0.0005, (vol.EURUSD * 100).toFixed(4) + '%');

  // 关键：各品种相对真实市场的放大系数必须一致，否则某个品种会明显失真
  const REAL_DAILY = { EURUSD: 0.45, GBPUSD: 0.60, USDJPY: 0.55, XAUUSD: 1.10, BTCUSD: 3.50 };
  let lo = Infinity;
  let hi = 0;
  for (const sym of Object.keys(C.INSTRUMENTS)) {
    const ratio = (vol[sym] * Math.sqrt(1440) * 100) / REAL_DAILY[sym];
    lo = Math.min(lo, ratio);
    hi = Math.max(hi, ratio);
  }
  ok('相对真实市场的放大系数一致（1.5~2.5x）', lo > 1.5 && hi < 2.5, `${lo.toFixed(2)}x ~ ${hi.toFixed(2)}x`);
}

console.log('\n[16] 宏观趋势与《FX战士》剧情事件');
{
  const ST = C.STORY_EVENTS;
  ok('共 12 集', ST.length === 12);
  ok('从第 7 天开播', ST[0].day === 7);
  ok('每 7 天一集', ST.every((e, i) => e.day === 7 * (i + 1)), ST.map((e) => e.day).join(','));
  ok('全部作用于 USDJPY', ST.every((e) => e.symbol === 'USDJPY'));
  ok('方向均为日元升值（USDJPY 下跌）', ST.every((e) => e.jump < 0));

  // 跑到第 7 天
  const m = new FXMarket('USDJPY', 2024);
  let story = null;
  let prev = m.price;
  let drop = 0;
  for (let i = 0; i < 8300; i++) {
    const r = m.tick() || {};
    if (r.story && !story) {
      story = r.story;
      drop = m.price / prev - 1;
    }
    prev = m.price;
  }
  ok('第 7 天播出第 1 集', !!story && story.episode === 1, story ? `第${story.episode}集「${story.title}」` : '未触发');
  ok('播出后 USDJPY 明显下跌', drop < -0.003 && drop > -0.02, (drop * 100).toFixed(2) + '%');

  // 宏观趋势：锚点只受 drift 影响，是最干净的判据
  ok('宏观趋势推动锚点上移（日元长期贬值）', m.anchor > m.inst.price,
    `${m.inst.price} → ${m.anchor.toFixed(3)}`);

  const me = new FXMarket('EURUSD', 2024);
  for (let i = 0; i < 3000; i++) me.tick();
  ok('无趋势品种的锚点不动', near(me.anchor, me.inst.price, 1e-9), String(me.anchor));

  // 已播出的剧集不得重复触发
  const m3 = new FXMarket('USDJPY', 2024);
  m3.restoreState({ tick: 8000, fired: ['EP1'], story: null });
  let again = null;
  for (let i = 0; i < 400; i++) {
    const r = m3.tick() || {};
    if (r.story) again = r.story;
  }
  ok('已播剧集不会重复触发', !again || again.episode !== 1, again ? `EP${again.episode}` : '未触发');

  // 存档往返
  const snap = m.serialize();
  ok('serialize 含进度与已播剧集', snap.tick > 0 && Array.isArray(snap.fired) && snap.fired.length >= 1);
  const m4 = new FXMarket('USDJPY', 2024);
  m4.restoreState(snap);
  ok('restoreState 还原 tick 进度', m4.tickIndex === snap.tick);
  ok('restoreState 还原已播剧集', m4.firedStories.size === m.firedStories.size);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
