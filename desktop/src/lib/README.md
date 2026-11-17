# lib/

纯函数工具与加密原语：无 React、无副作用、无 IO，供 services/components 复用。

## 文件清单

| 文件 | 导出 | 说明 |
| --- | --- | --- |
| `utils.ts` | `formatDuration(seconds → m:ss)` | 时间格式化 |
| `utils.ts` | `clamp(value, min, max)` | 数值区间约束 |
| `crypto/weapi.ts` | `weapi(data) → Promise<{ params, encSecKey }>` | 网易云 weapi 加密 |
| `crypto/weapi.ts` | `eapi(path, data) → string` | 网易云 eapi 加密，返回大写十六进制的 `params` |
| `crypto/weapi.ts` | `linuxapi(data) → string` | 网易云 linuxapi 加密，返回 `eparams` |

算法、密钥与 RSA 公钥定义在 `@lx/core` 的 `wy-crypto`（两端共用），本文件只提供 AES / RSA / MD5 原语。

## 依赖

- `crypto-js`：AES-CBC / AES-ECB 加密。
- `node-forge`：RSA-no-padding 签名。

## 使用场景

- `weapi`：只被 `services/wyRequest.ts`（桌面唯一的 weapi 通道）调用；`eapi` / `linuxapi`：被 `services/wyAccountService.ts` 与 `services/sources/wyProvider.ts` 调用。
- `formatDuration` / `clamp`：被 `components/PlayerBar`、`services/playerEngine.ts` 等用于播放进度与时间显示。
