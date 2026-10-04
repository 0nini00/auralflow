# 桌面前端可靠性修复计划

用户批准按全面审查推进，保留既有布局，不自动提交或发布。前轮四功能与沉浸页修改保留。

- [x] 在线页面worker：SearchView部分失败保留成功结果；PersonalFmView失败/空状态停止自动循环；PlaylistDetailView来源/id/请求代次统一加载和刷新。真实组件回归覆盖导航串线。
- [x] 设置worker：WyCookieLoginModal轮询与提交生命周期分离；SyncSettingsSection加载/dirty/保存/主动清空统一，失败可见；测试时不使用真实凭据。
- [x] 库/下载worker：PlaylistsView链接导入取消作废且卡片使用Link；downloadStore区别取消失败、native文件完成与后处理完成，DownloadsView准确反馈。
- [x] 公共交互worker：useKeyboardShortcuts避让已消费事件与交互控件；Header可访问联想选择；useDialogFocus统一顶层modal的Tab/Escape/焦点恢复，并逐步接入现有弹窗。
- [x] 主代理：PlayerBar拖动初始化/取消/换歌/同帧提交，playerSync控制动作单Tauri通道，沉浸及桌面歌词共用校正时钟。先运行9项失败场景再实现。
- [x] 集成：焦点hook接入其他worker负责的登录/歌单弹窗、沉浸式；核对portal菜单层级与busy不可关闭。
- [x] 验证：pnpm test:desktop（每次60秒），pnpm test:core、pnpm check:all、pnpm desktop:build；实际浏览器交互冒烟、独立复审、git diff --check。

副作用边界：取消只停止可控制的等待与后续提交，不伪装已撤回原生写入。状态只由当前身份对应请求驱动，错误不吞掉，不用空默认覆盖磁盘。


## 收尾记录

- 账号请求缓存按登录世代隔离；登录提交/回滚跨弹窗实例串行，退出持久化失败恢复原身份但不恢复旧缓存/请求。
- WebDAV 设置仅提交 dirty 字段；读取与写入顺序协调，卸载取消尚未发出的旧保存，主动清空正常落盘。
- 部分搜索/歌单刷新失败使用紧凑非阻塞提示，已有内容继续可用。
- 菜单通过 aria-controls 声明实际 portal 归属，避免焦点陷阱打断歌单/音质选择。底栏拖动保留手势身份直到松开，换歌后的旧手势不会转成新歌 seek。
- 最终桌面 389 项、核心 131 项测试通过；check:all 和 desktop:build 通过。保留既有移动端 2 条 lint 警告与 Vite 混合导入提示，无新增错误。
- 实际浏览器沉浸页多尺寸、hover/触屏/键盘/菜单/进度冒烟通过；账号/文件/网络边界使用受控替身，不代表真实账号或原生下载端到端验收。
- 保留既有外观和前轮未提交改动，本轮未提交、未发布。
