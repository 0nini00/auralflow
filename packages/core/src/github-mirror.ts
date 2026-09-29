/**
 * GitHub 下载直链 → 加速镜像直链。
 *
 * 为什么需要：本项目把安装包放在 GitHub Releases，而在国内直连 release 资产域名实测
 * **12 秒下载 0 字节**（同一个 64 MB 安装包走加速镜像 7.6 MB/s、8 秒下完）。
 * 更新路径若不做改写，用户就必须一直挂着代理才能更新。
 *
 * 安全性：改写只影响「从哪台机器取字节」，**不影响内容校验**——桌面端由 Tauri updater
 * 强制校验安装包签名（不可关闭），移动端由 Android 在安装时校验 APK 签名。
 * 镜像无法伪造一个能通过校验的包。
 *
 * 放在 core：这是纯逻辑，而移动端没有测试框架；桌面端发布脚本用的是同一套判定，
 * 两边对「哪些域名可镜像」必须给出一致答案。
 */

/** 默认镜像前缀（保留尾部斜杠）。发布脚本与两端共用同一默认值。 */
export const GITHUB_MIRROR_PREFIX = "https://gh-proxy.com/";

/**
 * 可镜像的下载类域名。release 资产在 github.com 上会 302 到后两个 hosts，
 * 所以三者都要认；`raw.githubusercontent.com` 之类**不在**这里（更新包不走它）。
 */
const MIRRORABLE_HOSTS = [
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
];

/**
 * 是否是「值得走镜像」的 GitHub 下载直链。
 *
 * 刻意手写解析而不是 `new URL()`：RN 的 URL polyfill 并不完整（仓库里已有先例：
 * `cover-image.ts` 因为它把 pathname 标只读而改用字符串拼接）。这里只取协议与主机名。
 */
export function isMirrorableGithubUrl(url: string): boolean {
  const value = typeof url === "string" ? url.trim() : "";
  const match = /^(https?):\/\/([^/?#]+)/i.exec(value);
  if (!match) return false;
  const host = match[2].toLowerCase().split(":")[0];
  return MIRRORABLE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * 把 GitHub 下载直链改写成镜像直链。
 *
 * - 前缀为空 / 地址非 GitHub 下载域名 / 非法输入 ⇒ **原样返回**（改不动就不动，
 *   宁可慢也不要指向一个拼坏的地址）；
 * - 已经是镜像地址 ⇒ 原样返回，避免套成两层前缀。
 */
export function toMirroredGithubUrl(
  url: string,
  prefix: string = GITHUB_MIRROR_PREFIX,
): string {
  const value = typeof url === "string" ? url.trim() : "";
  const mirror = typeof prefix === "string" ? prefix.trim() : "";
  if (!value || !mirror) return value;
  if (value.startsWith(mirror)) return value;
  if (!isMirrorableGithubUrl(value)) return value;
  const normalizedPrefix = mirror.endsWith("/") ? mirror : `${mirror}/`;
  return `${normalizedPrefix}${value}`;
}
