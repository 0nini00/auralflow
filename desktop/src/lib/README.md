# lib/

纯函数工具与加密原语：无 React、无副作用、无 IO，供 services/components 复用。

## 文件清单

| 文件 | 导出 | 说明 |
| --- | --- | --- |
| `utils.ts` | `formatDuration(seconds → m:ss)` | 时间格式化 |
| `utils.ts` | `clamp(value, min, max)` | 数值区间约束 |
| `crypto/weapi.ts` | `weapi(data) → { params, encSecKey }` | 网易云 weapi 加密：双 AES-CBC + RSA-no-padding 反转密钥 |
| `crypto/weapi.ts` | `eapi(path, data) → { params }` | 网易云 eapi 加密：MD5 摘要 + AES-ECB |
| `crypto/weapi.ts` | `WY_IV` / `WY_PRESET_KEY` / `WY_EAPI_KEY` | 硬编码 AES 密钥与 IV |
| `crypto/weapi.ts` | 网易 RSA 公钥 | weapi `encSecKey` 所用 |

## 依赖

- `crypto-js`：AES-CBC / AES-ECB 加密。
- `node-forge`：RSA-no-padding 签名。

## 使用场景

- `weapi` / `eapi`：被 `services/wyAccountService.ts` 及网易相关请求链调用，构造请求体密文。
- `formatDuration` / `clamp`：被 `components/PlayerBar`、`services/playerEngine.ts` 等用于播放进度与时间显示。
