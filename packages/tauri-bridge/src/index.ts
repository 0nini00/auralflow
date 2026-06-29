/**
 * @lx/tauri-bridge
 *
 * 所有 Tauri invoke 调用的类型化封装。
 * 类型定义与 src-tauri/src/models.rs 严格对齐（#[serde(rename_all = "camelCase")]）。
 */

import { invoke } from "@tauri-apps/api/core";

// ─── Rust 模型类型（camelCase 序列化） ─────────────────────

export interface RustAppSettings {
  theme: string;
  volume: number;
  defaultQuality: string;
  pauseOnExternalPlayback: boolean;
  wyCookie?: string | null;
  lyricPinned: boolean;
  lyricLocked: boolean;
  lyricPauseHide: boolean;
  lyricFontSize: number;
  lyricShowNextLine: boolean;
  lyricSingleLine: boolean;
  lyricMaxLineNum: number;
  lyricShowTranslation: boolean;
  lyricAlign: string;
  lyricLineGap: number;
  lyricFontWeight: number;
  lyricActiveColor: string;
  lyricNextColor: string;
  lyricShadowColor: string;
  lyricTextOpacity: number;
  lyricBackgroundOpacity: number;
  lyricTextPositionX: number;
  lyricTextPositionY: number;
  lyricHoverHide: boolean;
  lyricEnableAnimation: boolean;
  lyricAnimationIntensity: string;
  lyricWindowX?: number | null;
  lyricWindowY?: number | null;
  lyricWindowWidth?: number | null;
  lyricWindowHeight?: number | null;
  pactAccepted: boolean;
  cursorEffect: string;
  webdavUrl?: string | null;
  webdavUsername?: string | null;
  webdavPassword?: string | null;
  customSourceAutoCheck: boolean;
}

export interface RustLyricWindowPlayerToggleResult {
  action: "opened" | "closed" | "unlocked";
  open: boolean;
  locked: boolean;
  message: string;
}

export interface RustLyricWindowPlayerUnlockResult {
  unlocked: boolean;
  open: boolean;
  locked: boolean;
}

export interface RustLyricWindowState {
  open: boolean;
  locked: boolean;
}

export interface RustAudioFile {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  format: string;
  size: number;
  cover_data?: string | null;
  lyrics?: string | null;
}

export interface RustDownloadProgressEvent {
  taskId: string;
  downloaded: number;
  total?: number | null;
  progress: number;
  speed: number;
}

export interface RustDownloadCompletedEvent {
  taskId: string;
  savedPath: string;
  total: number;
}

// ─── 类型化 invoke 封装 ─────────────────────────────────

/** 加载设置 */
export async function loadSettings(): Promise<RustAppSettings> {
  return invoke<RustAppSettings>("load_settings");
}

/** 保存设置 */
export async function saveSettings(settings: RustAppSettings): Promise<RustAppSettings> {
  return invoke<RustAppSettings>("save_settings", { settings });
}

/** 部分更新设置 */
export async function patchSettings(patch: Record<string, unknown>): Promise<RustAppSettings> {
  return invoke<RustAppSettings>("patch_settings", { patch });
}

/** 重置设置 */
export async function resetSettings(): Promise<RustAppSettings> {
  return invoke<RustAppSettings>("reset_settings");
}

/** 扫描本地目录 */
export async function scanDirectory(path: string): Promise<RustAudioFile[]> {
  return invoke<RustAudioFile[]>("scan_directory", { path });
}

/** 获取单个音频文件信息 */
export async function getAudioInfo(path: string): Promise<RustAudioFile> {
  return invoke<RustAudioFile>("get_audio_info", { path });
}

/** 写入音频元数据（标题/艺术家/专辑），未传字段保持不变 */
export async function setAudioMetadata(
  path: string,
  fields: { title?: string; artist?: string; album?: string },
): Promise<void> {
  await invoke<void>("set_audio_metadata", {
    path,
    title: fields.title ?? null,
    artist: fields.artist ?? null,
    album: fields.album ?? null,
  });
}

/** 写入封面图片，coverData 为 data URL（data:image/...;base64,...） */
export async function setAudioCover(path: string, coverData: string): Promise<void> {
  await invoke<void>("set_audio_cover", { path, coverData });
}

/** 写入内嵌歌词（LRC/纯文本），空串清除 */
export async function setAudioLyrics(path: string, lyrics: string): Promise<void> {
  await invoke<void>("set_audio_lyrics", { path, lyrics });
}

/** 下载远程文件到本地目录，返回保存路径 */
export async function downloadFile(
  taskId: string,
  url: string,
  directory: string,
  fileName: string,
): Promise<string> {
  return invoke<string>("download_file", { taskId, url, directory, fileName });
}

/** 写入下载目录里的文本文件，用于同名 LRC 等下载附属文件 */
export async function writeDownloadTextFile(
  directory: string,
  fileName: string,
  contents: string,
): Promise<string> {
  return invoke<string>("write_download_text_file", { directory, fileName, contents });
}

// ─── 用户数据持久化（B-mid） ────────────────────

/** 用户数据命名空间 */
export type LibraryNamespace =
  | "favorites"
  | "playlists"
  | "library"
  | "customSources"
  | "recent"
  | "soundEffect";

/** 读取某个 namespace；文件不存在或为空返回 null */
export async function libraryLoad<T = unknown>(
  namespace: LibraryNamespace,
): Promise<T | null> {
  const value = await invoke<T | null>("library_load", { namespace });
  return value ?? null;
}

/** 写入某个 namespace（整体覆盖） */
export async function librarySave(
  namespace: LibraryNamespace,
  value: unknown,
): Promise<void> {
  await invoke<void>("library_save", { namespace, value });
}

/** 重置单个 namespace */
export async function libraryReset(namespace: LibraryNamespace): Promise<void> {
  await invoke<void>("library_reset", { namespace });
}

/** 重置所有用户数据 */
export async function libraryResetAll(): Promise<void> {
  await invoke<void>("library_reset_all");
}

// ─── 桌面歌词窗口 ────────────────────

/** 切换桌面歌词窗口；返回 true=已打开，false=已关闭 */
export async function toggleLyricWindow(): Promise<boolean> {
  return invoke<boolean>("toggle_lyric_window");
}

/** 播放器按钮专用切换：未开则开，已开未锁则关，已开已锁则先解锁 */
export async function toggleLyricWindowFromPlayer(): Promise<RustLyricWindowPlayerToggleResult> {
  return invoke<RustLyricWindowPlayerToggleResult>("toggle_lyric_window_from_player");
}

/** 播放器按钮第一步：如果桌面歌词已锁定则只解锁，不关闭 */
export async function unlockLyricWindowFromPlayer(): Promise<RustLyricWindowPlayerUnlockResult> {
  return invoke<RustLyricWindowPlayerUnlockResult>("unlock_lyric_window_from_player");
}

/** 查询桌面歌词窗口状态，以 Rust 后端运行时状态为准 */
export async function getLyricWindowState(): Promise<RustLyricWindowState> {
  return invoke<RustLyricWindowState>("get_lyric_window_state");
}

/** 标记桌面歌词即将锁定，供播放器按钮处理后端状态滞后 */
export async function prepareLyricWindowLock(): Promise<number> {
  return invoke<number>("prepare_lyric_window_lock");
}

/** 查询桌面歌词窗口是否已打开 */
export async function isLyricWindowOpen(): Promise<boolean> {
  return invoke<boolean>("is_lyric_window_open");
}

/** 设置桌面歌词窗口的置顶状态（持久化） */
export async function setLyricWindowPinned(pinned: boolean): Promise<void> {
  await invoke<void>("set_lyric_window_pinned", { pinned });
}

/** 设置桌面歌词窗口锁定状态（鼠标穿透，持久化） */
export async function setLyricWindowLocked(
  locked: boolean,
  lockEpoch?: number,
  lockSource?: string,
): Promise<boolean> {
  return invoke<boolean>("set_lyric_window_locked", { locked, lockEpoch, lockSource });
}
