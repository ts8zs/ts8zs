/* 确定性伪随机：同一种子 => 完全相同的行情，支持回放与种子挑战 */
(function (global) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 带 gauss() 的随机源（Box-Muller，带缓存） */
  function makeRng(seed) {
    const r = mulberry32(seed >>> 0);
    let spare = null;
    r.gauss = function () {
      if (spare !== null) {
        const v = spare;
        spare = null;
        return v;
      }
      let u = 0, v = 0, s = 0;
      do {
        u = r() * 2 - 1;
        v = r() * 2 - 1;
        s = u * u + v * v;
      } while (s === 0 || s >= 1);
      const m = Math.sqrt((-2 * Math.log(s)) / s);
      spare = v * m;
      return u * m;
    };
    return r;
  }

  function hashSeed(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  global.FXRng = { makeRng, hashSeed };
})(window);
