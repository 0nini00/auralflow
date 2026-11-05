'use strict';
// LX 运行时提供 Date；不暴露 Temporal。先收敛宿主 API，再让 SES 捕获 intrinsics。
// Chromium 不同版本的 Temporal 原型布局不同，不能让它决定桥是否能够启动。
if (!Reflect.deleteProperty(globalThis, 'Temporal')) {
  throw new Error('无法初始化音源隔离环境：Temporal 不可移除');
}
