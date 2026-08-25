# 网易云账号登录功能实现总结

## [完成] 已实现功能
- [完成] Cookie 登录（手动粘贴方式）
- [完成] 用户信息显示（昵称、头像、VIP 标识）
- [完成] 登录状态持久化（AsyncStorage）
- [完成] Cookie 有效性验证
- [完成] 退出登录

## 文件 核心文件
```
apps/mobile/src/services/wyAccountService.ts      # 登录逻辑与验证
apps/mobile/src/stores/accountStore.ts            # 账号状态管理
apps/mobile/src/screens/LoginScreen.tsx           # 登录界面
apps/mobile/src/components/AccountInfo.tsx        # 账号信息 UI
```

## 目标 核心实现
### wyAccountService.ts
通过 `fetch` 请求 `https://music.163.com/api/nuser/account/get` 接口验证 Cookie，并解析用户信息。

### accountStore.ts
使用 Zustand 管理登录状态（`isLoggedIn`, `user`），并封装了 `login`、`logout` 与状态校验方法。

### UI 集成
在 `LibraryScreen` 中通过模态框（Modal）形式唤起 `LoginScreen`。成功登录后，通过 `AccountInfo` 组件展示用户数据。

## 安全 安全说明
- Cookie 仅存储在设备本地（AsyncStorage）。
- 不会将 Cookie 上传至任何第三方服务器。
- 请勿将包含个人凭证的 Cookie 泄露给他人。

## 说明 获取 Cookie 指南
1. 在桌面浏览器访问 [music.163.com](https://music.163.com) 并登录。
2. 打开开发者工具 (F12) -> Network 标签，刷新页面。
3. 点击任意请求，在 `Request Headers` 中找到 `Cookie` 字段并复制。
4. 在移动端应用中进入“歌单”页面，点击“登录网易云账号”并粘贴即可。
