/* 波动率体检：把各品种实测波动换算成日波动率，与真实市场对照
   用法：npm run vol      （调完 config.js 的 sigmaTick 后跑一次，确认没有跑偏） */
global.window = global;
require('../src/rng.js');
require('../src/config.js');
require('../src/market.js');

const C = global.FXConfig;
const MINUTES_PER_DAY = 1440;

// 真实市场典型「日波动率」（对数收益标准差，%）
const REAL_DAILY = { EURUSD: 0.45, GBPUSD: 0.60, USDJPY: 0.55, XAUUSD: 1.10, BTCUSD: 3.50 };

const SAMPLES = 3000;

console.log(`\n每个品种跑 ${SAMPLES} tick（≈${(SAMPLES / MINUTES_PER_DAY).toFixed(1)} 个游戏交易日）\n`);
console.log('品种      实测σ/tick   日波动率   真实日波动   放大倍数   区间振幅');

let minRatio = Infinity;
let maxRatio = -Infinity;

for (const sym of Object.keys(C.INSTRUMENTS)) {
  const inst = C.INSTRUMENTS[sym];
  const m = new global.FXMarket(sym, 31415);
  let prev = m.price;
  let sum = 0;
  let n = 0;
  let lo = m.price;
  let hi = m.price;

  for (let i = 0; i < SAMPLES; i++) {
    m.tick();
    const r = Math.log(m.price / prev);
    prev = m.price;
    sum += r * r;
    n++;
    if (m.price < lo) lo = m.price;
    if (m.price > hi) hi = m.price;
  }

  const sigma = Math.sqrt(sum / n);
  const daily = sigma * Math.sqrt(MINUTES_PER_DAY) * 100;
  const ratio = daily / REAL_DAILY[sym];
  const amp = ((hi - lo) / inst.price) * 100;
  minRatio = Math.min(minRatio, ratio);
  maxRatio = Math.max(maxRatio, ratio);

  console.log(
    sym.padEnd(9),
    (sigma * 100).toFixed(4).padStart(8) + '%',
    daily.toFixed(2).padStart(9) + '%',
    REAL_DAILY[sym].toFixed(2).padStart(11) + '%',
    ratio.toFixed(2).padStart(9) + 'x',
    amp.toFixed(1).padStart(11) + '%'
  );
}

console.log(`\n放大倍数区间：${minRatio.toFixed(2)}x ~ ${maxRatio.toFixed(2)}x`);
if (maxRatio > 2.5 || minRatio < 1.5) {
  console.log('⚠ 有品种偏离统一的放大系数（目标 1.5~2.5x），检查 sigmaTick 是否需要调整');
  process.exit(1);
}
console.log('✓ 各品种放大系数一致');
