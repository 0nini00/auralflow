const fs = require('node:fs');
const path = require('node:path');

const root = path.dirname(require.resolve('react-native-fs/package.json'));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (version !== '2.20.0') throw new Error(`RNFS 下载超时补丁需重新核验版本：${version}`);
const target = path.join(root, 'android/src/main/java/com/rnfs/Downloader.java');
const source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
const before = '        connection.setConnectTimeout(5000);\n        connection.connect();';
// 手工重定向创建了新连接，必须继承原请求期限，否则停止标记也无法唤醒阻塞的read。
const after = '        connection.setConnectTimeout(param.connectionTimeout);\n        connection.setReadTimeout(param.readTimeout);\n        connection.connect();';
if (source.includes(before)) fs.writeFileSync(target, source.replace(before, after));
else if (!source.includes(after)) throw new Error('RNFS 下载超时补丁无法匹配目标代码');
