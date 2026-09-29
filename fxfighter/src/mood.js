/* 立绘表情档位：纯逻辑，便于单独测试 */
(function (global) {
  'use strict';

  const C = global.FXConfig;

  // 按盈亏分档：img/ 下七张独立图片
  const MOODS = [
    { file: '发财.png', name: '发财啦！' },
    { file: '小赚.png', name: '小赚一笔' },
    { file: '微赚.png', name: '有点起色' },
    { file: '一般.png', name: '平静观望' },
    { file: '微亏.png', name: '有点小亏' },
    { file: '小亏.png', name: '亏得心疼' },
    { file: '大亏.png', name: '亏惨了，装死中' }
  ];

  function srcOf(file) {
    return 'img/' + encodeURIComponent(file);
  }

  /**
   * 依据净值相对「基准本金」的涨跌幅选档位。
   *
   * baseline 会随游戏推进重新锚定（赚多了本金就跟着变大），所以日常浮动是相对
   * 近期水平判断的；但相对「初始本金」的方向性必须成立：
   *   - 低于初始本金 => 一定是负面档位（微亏/小亏/大亏）
   *   - 高于初始本金 => 永远不会是最差档位（大亏）
   *
   * @param {number} equity 当前净值
   * @param {number} baseline 当前基准本金
   * @param {number} startBalance 初始本金
   * @returns {number} 0~6 档位索引
   */
  function frameOf(equity, baseline, startBalance) {
    const base = baseline > 0 ? baseline : startBalance;
    const t = C.MASCOT.thresholds;
    const pct = ((equity - base) / base) * 100;

    let f;
    if (pct >= t[0]) f = 0;
    else if (pct >= t[1]) f = 1;
    else if (pct >= t[2]) f = 2;
    else if (pct > -t[2]) f = 3;
    else if (pct > -t[1]) f = 4;
    else if (pct > -t[0]) f = 5;
    else f = 6;

    if (equity < startBalance && f < 4) f = 4;   // 亏着本金，不该给她笑脸
    if (equity > startBalance && f === 6) f = 5; // 高于本金，谈不上「大亏」
    return f;
  }

  global.FXMood = { MOODS, frameOf, srcOf };
})(typeof window !== 'undefined' ? window : globalThis);
