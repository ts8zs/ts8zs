/* 全部可调数值集中在此，禁止在逻辑里硬编码 */
(function (global) {
  'use strict';

  const INSTRUMENTS = {
    USDJPY: {
      symbol: 'USDJPY',
      name: '美元/日元',
      price: 149.5,
      digits: 3,
      pip: 0.01,
      contractSize: 100000,
      spread: 0.014,
      sigmaTick: 0.00015,
      // 宏观趋势：日元长期贬值 => USDJPY 长期上行，每日约 +0.06%
      driftTick: 4.2e-7,
      lotStep: 0.01,
      minLot: 0.01,
      maxLot: 50,
      inverse: true,
      unlocked: true
    },
    EURUSD: {
      symbol: 'EURUSD',
      name: '欧元/美元',
      price: 1.085,
      digits: 5,
      pip: 0.0001,
      contractSize: 100000, // 1 标准手
      spread: 0.00012,      // 绝对价格差
      sigmaTick: 0.00013,   // 每 tick（=1 分钟）对数收益标准差
      lotStep: 0.01,
      minLot: 0.01,
      maxLot: 50,
      inverse: false,       // true => 盈亏需除以现价（如 USDJPY）
      unlocked: true
    },
    GBPUSD: {
      symbol: 'GBPUSD',
      name: '英镑/美元',
      price: 1.272,
      digits: 5,
      pip: 0.0001,
      contractSize: 100000,
      spread: 0.00018,
      sigmaTick: 0.00018,
      lotStep: 0.01,
      minLot: 0.01,
      maxLot: 50,
      inverse: false,
      unlocked: true
    },
    XAUUSD: {
      symbol: 'XAUUSD',
      name: '黄金/美元',
      price: 2018.5,
      digits: 2,
      pip: 0.1,
      contractSize: 100,    // 1 手 = 100 盎司
      spread: 0.35,
      sigmaTick: 0.00035,
      lotStep: 0.01,
      minLot: 0.01,
      maxLot: 20,
      inverse: false,
      unlocked: true
    },
    BTCUSD: {
      symbol: 'BTCUSD',
      name: '比特币/美元',
      price: 43200,
      digits: 2,
      pip: 1,
      contractSize: 1,
      spread: 18,
      // 每 tick 0.11%：日波动约 7%，是真实的 2 倍（与外汇品种同一放大系数），
      // 同时是 EURUSD 的 8.5 倍 —— 与真实市场 BTC/EURUSD ≈ 7.8 倍的比例一致
      sigmaTick: 0.0011,
      lotStep: 0.01,
      minLot: 0.01,
      maxLot: 5,
      inverse: false,
      unlocked: true
    }
  };

  /* 波动率状态机：越靠后越刺激 */
  const VOL_STATES = [
    { id: 'calm', name: '平静', mult: 0.55, minTicks: 40, maxTicks: 120, weight: 3 },
    { id: 'normal', name: '常规', mult: 1.0, minTicks: 60, maxTicks: 180, weight: 5 },
    { id: 'active', name: '活跃', mult: 1.9, minTicks: 30, maxTicks: 90, weight: 3 },
    { id: 'shock', name: '冲击', mult: 3.6, minTicks: 12, maxTicks: 40, weight: 1 }
  ];

  /* 财经新闻：定期注入跳空，制造节奏差。
     jump = 该品种 sigmaTick 的倍数（而非固定百分比），
     这样 EURUSD 与 BTCUSD 的同一事件幅度会自动适配各自波动率 */
  const EVENTS = [
    { name: '美国非农就业数据', impact: 3, jump: 18 },
    { name: '美国 CPI 通胀数据', impact: 3, jump: 15 },
    { name: '美联储利率决议', impact: 3, jump: 22 },
    { name: '日本央行货币政策会议', impact: 3, jump: 16 },
    { name: '日本财务省口头干预汇市', impact: 2, jump: 12 },
    { name: '欧洲央行行长讲话', impact: 2, jump: 10 },
    { name: '英国 GDP 数据', impact: 2, jump: 8 },
    { name: '制造业 PMI 初值', impact: 1, jump: 5 },
    { name: '地缘局势突发消息', impact: 3, jump: 20 },
    { name: '全球避险情绪升温', impact: 2, jump: 11 }
  ];

  /* 剧情事件：《FX战士》每周更新一集，播出后日元短线走强（USDJPY 下跌），
     随后缓慢回到长期贬值轨道。第 7 天开播，每 7 天一集，共 12 集。
     jump 为负 = USDJPY 下跌 = 日元升值；bars = 回归到趋势线所用的 tick 数 */
  const STORY_EVENTS = [
    { day: 7,  ep: 1,  title: '初入汇市',   symbol: 'USDJPY', jump: -0.006, bars: 120 },
    { day: 14, ep: 2,  title: '杠杆的诱惑', symbol: 'USDJPY', jump: -0.007, bars: 120 },
    { day: 21, ep: 3,  title: '止损线',     symbol: 'USDJPY', jump: -0.008, bars: 120 },
    { day: 28, ep: 4,  title: '非农之夜',   symbol: 'USDJPY', jump: -0.007, bars: 120 },
    { day: 35, ep: 5,  title: '锁仓陷阱',   symbol: 'USDJPY', jump: -0.009, bars: 120 },
    { day: 42, ep: 6,  title: '保证金追缴', symbol: 'USDJPY', jump: -0.010, bars: 120 },
    { day: 49, ep: 7,  title: '逆势加仓',   symbol: 'USDJPY', jump: -0.009, bars: 120 },
    { day: 56, ep: 8,  title: '爆仓',       symbol: 'USDJPY', jump: -0.012, bars: 120 },
    { day: 63, ep: 9,  title: '复利奇迹',   symbol: 'USDJPY', jump: -0.010, bars: 120 },
    { day: 70, ep: 10, title: '央行决议',   symbol: 'USDJPY', jump: -0.013, bars: 120 },
    { day: 77, ep: 11, title: '最后的仓位', symbol: 'USDJPY', jump: -0.012, bars: 120 },
    { day: 84, ep: 12, title: '回到起点',   symbol: 'USDJPY', jump: -0.015, bars: 120 }
  ];

  const COSTS = {
    commissionPerLot: 0,   // MVP 先不收手续费，仅点差
    swapLongPerDay: -0.0002,  // 按仓位价值的日利率
    swapShortPerDay: -0.0001
  };

  const TIMEFRAMES = ['M1', 'M5', 'M15', 'H1', 'H4', 'D1'];
  const TF_MINUTES = { M1: 1, M5: 5, M15: 15, H1: 60, H4: 240, D1: 1440 };

  /* 真实经纪商提供的是固定档位（券商后台下拉选择，改动通常还要申请），
     不会让客户任意填写。这里按离岸券商的常见档位排列。
     参考监管上限：日本 25:1 · 美国 50:1 · 欧盟 ESMA 30:1 · 离岸可到 500:1 以上 */
  const LEVERAGES = [1, 5, 10, 20, 25, 50, 100, 200, 300, 400, 500];

  const RULES = {
    startBalance: 1000,
    defaultLeverage: 100,
    marginCallLevel: 100,  // 保证金率 < 100% 预警
    stopOutLevel: 50,      // 保证金率 < 50% 强制平仓
    bankruptBelow: 0.05,   // 余额低于初始资金的该比例 => 判定账户清算，本局结束
    tickMs: 1000,          // 1x 速度下 1 tick（=1 分钟行情）的真实耗时
    eventEveryTicks: 240,  // 平均每 240 tick（4 小时）一个事件
    warmupBars: 400,       // 预生成历史 K 线根数
    swapAtMinute: 0        // 每跨越 00:00 结算隔夜利息
  };

  /* 立绘表情档位：相对「基准本金」的涨跌幅阈值（%），负值对称取反。
     阈值放宽是为了避免几个 pip 的波动就让表情来回跳 */
  const MASCOT = {
    thresholds: [50, 20, 6],  // >=50 发财 / >=20 小赚 / >=6 微赚
    rebaseTicks: 1440         // 每 1440 tick（游戏内 1 个交易日）用当前净值重锚基准本金
  };

  global.FXConfig = {
    INSTRUMENTS,
    VOL_STATES,
    EVENTS,
    COSTS,
    TIMEFRAMES,
    TF_MINUTES,
    LEVERAGES,
    RULES,
    MASCOT,
    STORY_EVENTS
  };
})(window);
