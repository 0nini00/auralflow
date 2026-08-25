# 项目一致性与结构治理设计

## 背景

当前仓库已经完成一轮双端功能调整，但仍存在四类可验证问题：文档描述落后于实现、已移除音效功能仍有原生和持久化残留、根目录缺少覆盖双端与 Rust 的统一验证入口，以及若干跨职责超大模块和双端重复纯逻辑。修复必须保留现有路由、Zustand Store API、Tauri command 名称与 Android Bridge 行为，不能覆盖或回退工作区中已有的未提交改动。

## 目标

1. 文档只描述当前真实实现，不再声称使用 SoundTouch、均衡器或共享完整播放调度。
2. 删除已经无调用方的音效原生模块和持久化类型入口，但不主动删除用户磁盘上的历史 `soundEffect.json`。
3. 根目录提供 core、desktop、mobile、Rust 的独立测试脚本和统一 `test:all` 入口。
4. mobile 使用 Vitest 覆盖不依赖 React Native、TrackPlayer、Android 与网络的纯逻辑。
5. 将 `SettingsView.tsx`、`commands.rs` 与 `playerStore.ts` 按职责拆分，保持公开接口不变。
6. 将双端完全一致的自定义音源规范化、版本比较和远端脚本 URL 规则收敛到 `@lx/core`；WebDAV 继续复用共享合并算法，不统一平台网络层。

## 非目标

- 不重新引入均衡器、混响、声像或独立变调 UI。
- 不迁移、重写或删除现有用户数据文件。
- 不改变 React Navigation 路由名、Zustand action 名、Tauri command 名或 Android 原生模块的现有有效行为。
- 不把 WebView、Tauri、TrackPlayer、AsyncStorage 或 HTTP 客户端抽象成跨端统一运行时。
- 不在当前混合脏工作区自动创建提交。

## 设计

### 文档和死代码

以依赖清单、生产代码引用和注册入口为事实来源。删除 `SoundEffectModule.java` 及其 `LocalMusicPackage` 注册；从桌面 TypeScript 与 Rust 的命名空间白名单移除 `soundEffect`。Rust 不扫描也不删除旧文件，因此已有 `soundEffect.json` 保留在磁盘，只有新的前端调用无法再通过白名单访问。

### 测试入口

根脚本定义：

- `test:core`: `pnpm --filter @lx/core test`
- `test:desktop`: `pnpm --filter @auralflow/desktop test`
- `test:mobile`: `pnpm --filter @auralflow/mobile test`
- `test:rust`: `cargo test --manifest-path desktop/src-tauri/Cargo.toml`
- `test:all`: 顺序执行以上四项
- `test`: 转发到 `test:all`

mobile 直接使用工作区已采用的 Vitest 2.x，测试文件只导入纯 TypeScript 模块。`tsconfig.json` 排除测试文件，避免 React Native 的生产类型检查被 Vitest 全局类型污染；Vitest 自己负责测试文件编译。

### SettingsView 拆分

`SettingsView` 保留导航状态、跨 Section 的异步协调和设置 Store 装配。视觉区块移动到 `desktop/src/views/settings/`：外观、播放、音源、桌面歌词、数据、同步、其他。每个 Section 通过显式 props 接收值和回调，不引入第二个状态容器或 Context。`SettingRow` 作为共享展示组件独立文件导出。

### Rust commands 拆分

`desktop/src-tauri/src/commands.rs` 变为命令聚合入口，按领域声明子模块并 `pub use`：settings、compression、media_cache、bili、downloads、local_audio、library、lyric_window。`main.rs` 继续引用 `commands::<command_name>`，所有 `#[tauri::command]` 函数名、参数和返回值保持不变。只移动私有 helper 与其唯一使用者，不复制常量或校验逻辑。

### playerStore 拆分

Store 保留 TrackPlayer 调用、Zustand 状态和 action API。纯逻辑放入可独立测试的模块：播放请求 key、错误自动跳歌决策、队列索引/顺序、FM 队列补充判定、睡眠计时状态转换。已有 `songQueueActions.ts`、`songSleepTimerModel.ts`、`playerRateModel.ts`、`playerVolumeModel.ts` 继续作为唯一实现，不在 Store 中复制。

### 跨端自定义音源逻辑

新增 `packages/core/src/custom-source.ts`，导出脚本文本规范化、版本规范化与比较、GitHub/Gitee 脚本 URL 规范化、远端脚本 URL 判断。mobile 与 desktop runtime 只保留各自的网络、沙箱/桥接和运行时缓存。共享函数使用平台无关的标准 `URL`，不导入 React Native 或 Tauri 代码。

### WebDAV

维持平台网络适配差异。双端合并行为只通过 `@lx/core/webdav-merge` 表达；若服务文件仍有同义合并实现，则改为调用共享函数并增加 core 单测。序列化、认证、路径和本地 Store 写入仍属于平台服务。

## 安全与兼容性不变量

- 自定义音源出站请求继续经过现有 public-host 校验。
- 删除音效命名空间不得触发历史文件删除。
- 所有异步失败继续显式抛出或显示状态，不增加静默 fallback。
- Tauri invoke 名称、Android 有效 NativeModule 名称、页面路由与 Store action 保持兼容。
- 每个结构移动后先运行定向测试/编译，再继续下一领域。

## 验证

最终证据包括：core/mobile/desktop/Rust 全部测试、双端 TypeScript typecheck、mobile lint、desktop build、cargo check、Android debug assemble（环境允许时）、`git diff --check`、音效残留引用扫描、公开命令与 Store action 对比检查。
