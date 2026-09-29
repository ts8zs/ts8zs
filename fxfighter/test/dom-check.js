/* DOM 一致性检查：node test/dom-check.js
   防止 main.js 引用了 index.html 中不存在的 id（运行时会静默变 null） */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');

const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const refs = new Set([...js.matchAll(/\$\(\s*["']#([A-Za-z0-9_-]+)["']\s*\)/g)].map((m) => m[1]));
const missing = [...refs].filter((r) => !ids.has(r));

console.log('index.html 中定义的 id :', ids.size);
console.log('main.js 中引用的 id    :', refs.size);
if (missing.length) {
  console.log('✗ 引用了不存在的 id    :', missing.join(', '));
  process.exit(1);
}
console.log('✓ 所有 DOM 引用均存在');

// 顺带校验 script 标签引用的文件都存在
const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
const bad = srcs.filter((s) => !fs.existsSync(path.join(root, s)));
if (bad.length) {
  console.log('✗ 缺失脚本文件:', bad.join(', '));
  process.exit(1);
}
console.log('✓ 全部 ' + srcs.length + ' 个脚本文件存在');
