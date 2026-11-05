const fs = require('node:fs');
const path = require('node:path');

// 锁文件固定版本；独立加载 SES，避免打包器重写其执行环境。
const target = path.join(__dirname, 'android/app/src/main/assets/lx_bridge');
const files = [
  ['ses', 'dist/ses.umd.min.js', 'ses.umd.min.js'],
  ['ses', 'LICENSE', 'ses.LICENSE.txt'],
  ['node-forge', 'dist/forge.min.js', 'forge.min.js'],
  ['node-forge', 'LICENSE', 'forge.LICENSE.txt'],
];
for (const [name, source, destination] of files) {
  const root = path.dirname(require.resolve(`${name}/package.json`));
  const content = fs.readFileSync(path.join(root, source));
  const output = path.join(target, destination);
  if (!fs.existsSync(output) || !fs.readFileSync(output).equals(content)) fs.writeFileSync(output, content);
}
