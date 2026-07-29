# 移动端验证基线（Sprint 1）

## 执行环境与命令

- 工作目录：`apps/mobile`
- package：`@auralflow/mobile@0.1.0`
- 脚本来源：`apps/mobile/package.json`
- 执行命令：
  - `npm run typecheck`
  - `npm test`
- 基线日期：2026-07-13（在补充 Drawer 返回键契约注释后复跑）

## 结果摘要

| 检查 | 退出状态 | 结果 | 说明 |
|---|---:|---|---|
| `npm run typecheck` | 0 | 通过 | TypeScript `tsc --noEmit` 无错误。 |
| `npm test` | 1 | 未通过（既有问题） | 100 个测试文件通过、5 个测试文件失败；325 个测试通过、5 个测试失败。失败均记录如下，不静默忽略。 |

## 已有失败逐项记录

以下失败是 Sprint 1 开始前移动端已有测试基线问题；本 Sprint 不修改稳定业务代码，因此不将其伪装成通过，也不归因于本 Sprint 文档交付：

1. `src/stores/playerStore.test.ts`
   - 用例：`player store playback rate > clamps playback rate before sending it to TrackPlayer`
   - 失败现象：播放速率 clamp 断言失败。
   - 基线处置：标记为既有问题；后续播放器专项 Sprint 单独定位，不在 Sprint 1 重写播放状态。
2. `src/services/__tests__/homeSearchEntryIntegration.test.ts`
   - 用例：`home search entry integration > wires the desktop home search shortcut into the mobile home screen`
   - 失败现象：首页搜索快捷入口集成断言失败。
   - 基线处置：标记为既有问题；后续内容页对齐 Sprint 处理。
3. `src/services/__tests__/localMusicEditIntegration.test.ts`
   - 用例：`local music edit integration > hides the download action for local music rows while keeping shared song actions`
   - 失败现象：本地音乐编辑/下载动作源码集成断言失败。
   - 基线处置：标记为既有问题；不在本 Sprint 修改本地音乐业务。
4. `src/services/__tests__/miniPlayerNavigationIntegration.test.ts`
   - 用例：`mini player navigation integration > exposes previous and next shortcuts like the desktop player bar`
   - 失败现象：MiniPlayer 上一首/下一首快捷入口集成断言失败。
   - 基线处置：标记为既有问题；后续播放器 Sprint 处理。
5. `src/services/__tests__/quickActionCoverIntegration.test.ts`
   - 用例：`quick action cover integration > passes liked and history covers into mobile quick action cards`
   - 失败现象：快捷操作卡片 liked/history 封面传递断言失败。
   - 基线处置：标记为既有问题；后续首页/内容页 Sprint 处理。

## 可复核证据

- `apps/mobile/package.json` 明确 `typecheck` 等价于 `tsc --noEmit`，`test` 等价于 `vitest run`。
- 本次完整测试命令的失败清单以上述 5 个文件为准；测试输出中未将失败隐藏或跳过。
- 重新执行时应保留命令输出，并更新本文件的日期、计数和失败清单；只有失败项被修复并重新运行全量测试后，才能将测试状态改为通过。

## 人工回归基线（本 Sprint 冻结）

后续实现必须至少复核：Drawer 初始关闭、汉堡打开、遮罩关闭、Android 返回键关闭、可配置边缘滑动；手机竖屏/横屏与平板竖屏/横屏；搜索提交、MiniPlayer→完整播放器→歌词、下载入口。详见 `docs/mobile-alignment-checklist.md`。
