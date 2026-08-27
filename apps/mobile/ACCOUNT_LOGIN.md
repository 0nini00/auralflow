# 账号登录实现

移动端账号登录支持网易云、B站、QQ 音乐三个音源，登录态与凭据分别由对应的 service / store 管理，安全存储与加密下沉到 Android 原生模块。

## 概览

| 音源 | 登录方式 | 验证接口 | Cookie | 状态 store |
| --- | --- | --- | --- | --- |
| 网易云 | Cookie 登录 + 二维码登录（type=3） | `weapi` `/weapi/w/nuser/account/get` | 需 `MUSIC_U` | `accountStore` |
| B站 | Cookie 登录 | WBI 签名 `/x/web-interface/nav` | 管理完整 cookie | `biliAccountStore` |
| QQ 音乐 | 无 cookie | `musicu.fcg`（`tmeLoginType=-1`） | 不需要 | 无独立账号 store |

## 网易云

### Cookie 登录

手动粘贴方式：用户在桌面浏览器登录 music.163.com，从开发者工具复制完整 Cookie（必须含 `MUSIC_U` 与 `__csrf`），粘贴进 `NeteaseAccountCard` 内嵌表单。

- `wyAccountService.validateWyCookie` 对齐桌面 `weapiCall/postWeapi`：POST `https://music.163.com/weapi/w/nuser/account/get`，body 为 `params` / `encSecKey` 表单（weapi 加密，详见下文「加密」）。
- 入参先校验 `/MUSIC_U=/.test(cookie)`，缺 `MUSIC_U` 直接报错「Cookie 中缺少 MUSIC_U」。
- 明文直连 `/api/nuser/account/get` 拿不到账号数据，必须走 weapi 加密接口。
- UA 必须完整（残缺 `AppleWebKit/537.36` 曾被风控拒绝返回 301）。

### 二维码登录（type=3 网易云音乐 App 码）

type=3 为网易云音乐 App 扫码登录，区别于微信/QQ 扫码。流程：

1. **申请 unikey**：调用网易接口获取 `unikey`（一次性密钥）。
2. **生成二维码**：用 unikey 拼出扫码 URL，渲染为 SVG 二维码展示给用户。
3. **轮询状态**：用 unikey 轮询扫码状态，按返回码分支：
   - `800` — 二维码过期，需重新申请 unikey 生成新码。
   - `801` — 等待扫码。
   - `802` — 已扫码，等待用户在 App 端确认。
   - `803` — 成功，返回登录 cookie。
4. **写 cookie**：成功后落库的 cookie 仍需 `MUSIC_U` 才能调通后续 weapi 接口。

### 过期处理

网易服务器对失效 cookie 返回 `code` ∈ {`301`, `401`, `403`}，`validateWyCookie` 统一抛「Cookie 无效或已过期」/「登录已过期」，由 `accountStore` 触发登出清理（见下文「登出与过期」）。

## B站

### Cookie 登录 + WBI 签名

- 用户粘贴 B站 cookie，`biliService` 用 `/x/web-interface/nav` 验证登录态：返回 `isLogin` 为假即抛「B站 Cookie 已过期或未登录」。
- B站多数接口需 **WBI 签名**：从 `/x/web-interface/nav` 的 `wbi_img.img_url` / `sub_url` 提取 `img_key` / `sub_key`，按 WBI 算法对查询参数签名（`w_rid` + `wts`）。`biliService` 内置 WBI key 缓存（`WBI_KEY_TTL_MS = 12h`），过期或首次访问时刷新。
- cookie 由 `biliAccountStore` 管理（见下文）。

## QQ 音乐

- **无 cookie**：直接请求 `https://u.y.qq.com/cgi-bin/musicu.fcg`，请求头固定 `Cookie: tmeLoginType=-1;`，无需用户登录。
- 用作搜索 / 元数据兜底（`DoSearchForQQMusicLite`，`search_type=0` 免登录），与网关配合补全歌曲信息。

## 安全存储

凭据统一由原生 `SecureStorageModule` 落盘（`android/.../SecureStorageModule.java`）：

- **Keystore**：Android Keystore 生成并保管 AES-256-GCM 密钥，密钥别名 `auralflow.mobile.secure-storage.v2`。
- **密文格式**：`v1:iv:ciphertext`（版本号 `v1` + base64 IV + base64 密文），便于后续格式升级。
- **自动迁移**：旧版用 AsyncStorage 明文存的凭据，启动时 `migrateLegacySecret` 自动迁移到 SecureStorage，迁移后清除旧明文条目。
- **损坏兜底**：Keystore 条目可能因系统升级 / 备份迁移损坏，此时加解密一律失败，模块会清理并重建密钥，避免永久卡死。

> 安全说明：cookie 仅存于设备本地 Keystore，不上传任何第三方服务器；请勿将含个人凭证的 cookie 泄露给他人。

## 加密（CryptoModule）

网易云 weapi 加密的 RSA NoPadding 步骤由原生 `CryptoModule` 承接，原因：**Hermes 处理不好 crypto-js / node-forge 的 RSA NoPadding**，纯 JS 实现在 Hermes 下会出错或性能不达标。

- **AES**：`AES/CBC/PKCS5Padding`（等价 crypto-js 的 PKCS7），加密 `params`。
- **RSA**：`RSA/ECB/NoPadding`，加密 `encSecKey`：
  - 将反转后的 secretKey（16 字节）**左侧零填充到 128 字节**（对齐 NeteaseCloudMusicApi：NoPadding 下小数值仍落在密钥空间内）。
  - 输出 **hex** 字符串（逐字节转两位十六进制）。
- 入口：`rsaNoPaddingEncrypt(text, publicKeyPem)` → Promise<string>。

## 状态管理

### accountStore（网易云）

- 状态：`isLoggedIn: boolean`、`user: WyUserInfo | null`、`loading`、`error`。
- 动作：`login(cookie)` → `loginWithCookie` → `validateWyCookie` → 落库；`logout()` → `clearWyAccount()` + 清状态；`checkStatus()` → `checkLoginStatus()`，失效时自动清状态。
- 登录成功后 `NeteaseAccountCard` 收起表单、`AccountInfo` 展示昵称 / 头像 / VIP 标识。

### biliAccountStore（B站）

- 状态：`account: BiliAccountInfo | null`、`playlists: BiliCollectionInfo[]`、`hiddenCollectionIds: string[]`、`autoShowNewCollections: boolean`。
- `hiddenCollectionIds` / `autoShowNewCollections` 控制合集广场可见性（隐藏指定合集、是否自动展示新合集），偏好持久化到 AsyncStorage。

## 登出与过期

- **网易云**：`clearWyAccount()` 清除 cookie / 用户信息；`accountStore.logout()` 调用它并重置 `isLoggedIn` / `user`。cookie 过期时 `checkLoginStatus` 自动清除登录态（auth-broken 检测：返回码 301/401/403 即判定失效，统一提示「登录已过期」）。
- **B站**：`/x/web-interface/nav` 返回 `isLogin=false` 即判定 cookie 过期，抛错并由 UI 引导重新登录。
- **QQ 音乐**：无登录态，无需登出。

## 核心文件

```text
apps/mobile/src/
├── services/
│   ├── wyAccountService.ts        # 网易云登录 / 验证 / 清除
│   ├── weapi.ts                    # weapi 加密（AES + 调用 CryptoModule 做 RSA NoPadding）
│   └── biliService.ts              # B站 cookie 验证 / WBI 签名 / 合集
├── stores/
│   ├── accountStore.ts             # 网易云账号状态
│   └── biliAccountStore.ts         # B站账号 / 合集可见性
├── components/settings/
│   ├── NeteaseAccountCard.tsx      # 网易云登录 UI（Cookie 表单）
│   └── BiliAccountCard.tsx         # B站登录 UI
└── screens/settings/
    └── AccountSettingsScreen.tsx   # 账号设置页入口
```

原生：

```text
apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/
├── SecureStorageModule.java        # Keystore AES-256-GCM，alias .v2，v1:iv:ciphertext，迁移
└── CryptoModule.java               # weapi AES/CBC/PKCS5Padding + RSA/ECB/NoPadding 128 字节左零填充→hex
```
