# 桌面 LX 自定义音源总开关实施计划

目标：新安装默认关闭；已有音源的旧数据迁移开启。关闭保留脚本、排序、逐源状态与本地音乐。总开关只在本机 customSources 命名空间保存，不通过 WebDAV 同步。

架构：customSourceStore.featureEnabled 为唯一持久化状态；customSourceAccess 以 getter 读取该状态，捕获带 AbortSignal 的生命周期令牌。关闭和重新开启使旧令牌永久失效。运行时通过参数接收令牌，不反向导入 store。不是脚本安全沙箱，已发出的请求不可宣称撤回。

## 独立写集与步骤
- [x] 主代理：desktop/src/stores/customSourceStore.ts、services/customSourceAccess.ts、services/customSourceRuntime.ts；先写迁移/生命周期/在途结果测试，再实现统一入口和受控清理。
- [x] UI worker：App.tsx、views/useSettingsViewModel.ts、views/settings/SourcesSettingsSection.tsx、components/CustomSourceUpdateModal.tsx；常驻开关、关闭隐藏管理、后台检查随开关取消。
- [x] 播放 worker：services/playback/{playbackResolver,customSourceBackend,prefetchModel,prefetchService}.ts、persistentCache.ts、playerStore.ts 缓存快路径；补传 backend、关闭排除 LX 与过期结果、保留内置缓存。
- [x] 同步 worker：webdavSyncService.ts、views/settings/SyncSettingsSection.tsx；入口与关键提交时刻校验令牌，关闭不发空列表，普通同步保持独立。
- [x] 集成：运行 desktop 单测、core 单测、desktop:typecheck、desktop:build，执行最小冒烟和独立代码审查；不提交 Git。

验证：pnpm --filter @auralflow/desktop test；pnpm test:core；pnpm desktop:typecheck；pnpm desktop:build；git diff --check。每条测试命令限制60秒；失败先定位，不以静默回退掩盖。
