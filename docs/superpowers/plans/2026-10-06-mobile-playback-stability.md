# 移动端播放稳定性与 v0.6.10 发布

## 已授权范围

- 修复竖屏播放页后台恢复时控制区上移，并改善竖屏布局稳定性。
- 修复后台连续播放停止、通知下一首无响应；保持用户播放模式与失败跳过设置。
- 连同本线程上一轮已完成的移动增强提交代码，构建正式 Android 更新并发布 GitHub Latest。
- 不重建桌面；发布时保留当前 Latest 的桌面更新清单，避免改变桌面更新行为。

## 根因与设计

- 布局：父级固定尺寸依赖子级 onLayout 反馈；Pager 子页尺寸与入场 translateY 动画在恢复时叠加。改用原生 flex 和固有控制区高度，控制区仅透明度转场。
- 后台：playbackService 提前完成 Headless JS 任务，RN JavaTimerManager 在 HostPause 后停止计时器。服务任务须与 native MusicService 实例生命周期一致，销毁时显式结束和清理监听，不增加永久唤醒锁。
- 播放解析：全链预算应包含预读等待、主源和跨源候选。通知/界面手动切歌必须能取消过时解析；原生播放提交仍保留意图校验。
- 恢复：自然曲末的解析失败与原生播放报错统一由后台服务协调，避免 UI 监听与后台服务互相等待处置结论。

## 清单

- [x] 核实工作区与原始版本；保留本线程已有未提交改动。
- [x] 竖屏布局 RED/GREEN 与渲染契约测试。
- [x] Headless 生命周期 RED/GREEN、原生补丁幂等性验证。
- [x] 解析总预算、取消和连续失败恢复回归。
- [x] 独立代码审查及修复。
- [x] 全量移动测试、类型检查、lint、双 ABI 正式构建。
- [x] Android 运行验证或明确设备环境限制；检查真实签名、版本、APK内容。
- [x] 提交并推送，创建 v0.6.10 tag，先上传草稿资产并核验后设为 Latest。
- [x] 核验公开 Latest、两种 APK 和桌面更新清单。

## 发布基线

- 当前移动 0.6.8 / versionCode 16；本次 0.6.10 / 17。
- 当前 GitHub Latest 为 v0.6.8，最新桌面 v0.6.9 未设为 Latest。
- 正式签名证书 SHA256：bdd358fe1e2f57afb348c54c71e4cc666cde664ced83650a6f5cdc3220c1b566。
- 不读取或记录私钥、密码；只使用现有 Gradle 外置签名配置。


## 发布前验证记录

- 移动端 215 项测试通过；类型检查通过；lint 无错误，保留无关文件两条既有警告。
- Debug 与正式构建均成功；正式 arm64-v8a、armeabi-v7a 的 versionName 0.6.10 / versionCode 17 与旧版签名匹配。
- Android 15 x86_64 模拟器中，应用保持后台时依次播放合成音频 1/2/3/5/7/8；第 4 首模拟失败自动跳过，第 6 首解析挂起后通过通知媒体下一首进入 7，无需切回 App。后台计时器在验证期间推进 34 次。
- 验证通过 Inspector 注入测试曲目和延迟/错误，真实执行 JS 服务与原生播放器，不等同于真实公网音源或手机厂商省电策略验收。
- 签名与资产摘要保存于忽略目录 dist/release-v0.6.10/artifact-verification.json。

- 最终 Debug 包上执行 5 次 HOME 返回和 1 次锁屏恢复，7 个控制按钮 bounds 最大变化 0 px；底部按钮距系统导航栏 31 px，未见遮挡。


## 发布完成

- 代码提交：6a7945cb30f46ac9d31f61451a98264410a25ae0，已推送 main；v0.6.10 tag 指向该提交。
- GitHub CI：https://github.com/0nini00/auralflow/actions/runs/37512028901，结果 success。
- Release：https://github.com/0nini00/auralflow/releases/tag/v0.6.10，已公开并设为 Latest。
- 四个上传资产的字节数与 SHA256 均匹配本地；正式两包签名与 v0.6.8 一致。
- 公开 APK 地址可访问；公开 latest.json / latest-mirror.json 与 v0.6.8 清单逐字节一致。
- 使用已发布元数据执行旧版更新客户端逻辑，0.6.8 检出 0.6.10，两个 ABI 选包正确。
- 本机出口的匿名 GitHub API 触发速率限制；Latest 元数据由已认证 API 核验，公开文件地址另行无认证验证。未宣称真实手机已完成应用内更新。
