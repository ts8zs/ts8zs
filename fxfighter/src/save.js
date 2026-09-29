/* localStorage 存档：整局状态（账户/持仓/行情进度/统计）持久化，刷新或关闭后可恢复 */
(function (global) {
  'use strict';

  const KEY = 'fxsim.save.v1';
  const VERSION = 1;

  function storage() {
    try {
      return global.localStorage || null;
    } catch (e) {
      return null; // 隐私模式 / 禁用存储
    }
  }

  function available() {
    const s = storage();
    if (!s) return false;
    try {
      const probe = '__fx_probe__';
      s.setItem(probe, '1');
      s.removeItem(probe);
      return true;
    } catch (e) {
      return false; // 配额耗尽
    }
  }

  function save(data) {
    const s = storage();
    if (!s) return false;
    try {
      s.setItem(KEY, JSON.stringify(Object.assign({ v: VERSION, savedAt: Date.now() }, data)));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** @returns {object|null} 存档不存在或版本不匹配时返回 null */
  function load() {
    const s = storage();
    if (!s) return null;
    try {
      const raw = s.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || d.v !== VERSION) return null;
      return d;
    } catch (e) {
      return null; // 存档损坏时静默降级为新开局，不能让游戏起不来
    }
  }

  function clear() {
    const s = storage();
    if (s) {
      try {
        s.removeItem(KEY);
      } catch (e) {}
    }
  }

  global.FXSave = { save, load, clear, available, KEY, VERSION };
})(typeof window !== 'undefined' ? window : globalThis);
