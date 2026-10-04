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
  replayGainEnabled: boolean;
  defaultQuality: string;
  pauseOnExternalPlayback: boolean;
  playbackFailedAutoNext: boolean;
  /** 跟随系统媒体控制（SMTC）：键盘媒体键 / 系统媒体浮层 / 锁屏控制 */
  followSystemMediaControl: boolean;
  /** 任务栏缩略图按钮与封面预览：悬停任务栏图标显示上一首 / 播放暂停 / 下一首与封面 */
  taskbarThumbnails: boolean;
  wyCookie?: string | null;
  lyricPinned: boolean;
  lyricLocked: boolean;
  lyricPauseHide: boolean;
  lyricFontSize: number;
  lyricShowNextLine: boolean;
  lyricSingleLine: boolean;
  lyricMaxLineNum: number;
  lyricShowTranslation: boolean;
  lyricShowRomanization: boolean;
  lyricShowRuby: boolean;
  lyricAlign: string;
  lyricLineGap: number;
  lyricFontWeight: number;
  lyricManualOffsetMs: number;
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
  immersiveLyricFontFamily: string;
  appBackgroundImagePath?: string | null;
  lyricWindowX?: number | null;
  lyricWindowY?: number | null;
  lyricWindowWidth?: number | null;
  lyricWindowHeight?: number | null;
  /** 主窗口：上次的 x（逻辑像素）。null=居中默认位置 */
  mainWindowX?: number | null;
  mainWindowY?: number | null;
  mainWindowWidth?: number | null;
  mainWindowHeight?: number | null;
  /** 主窗口：上次退出时是否最大化 */
  mainWindowMaximized: boolean;
  pactAccepted: boolean;
  cursorEffect: string;
  webdavUrl?: string | null;
  webdavUsername?: string | null;
  webdavPassword?: string | null;
  webdavAutoSyncPlaylists: boolean;
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
  coverData?: string | null;
  /** 封面在本地缓存中的文件路径（由 scan_directory/get_audio_info 落盘），前端用 convertFileSrc 显示 */
  coverPath?: string | null;
  lyrics?: string | null;
  replayGain?: { gainDb: number; peak?: number | null } | null;
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

export interface RemoteMediaCacheOptions {
  url: string;
  cacheKey: string;
}

export interface SongCacheStats {
  persistentCacheSize: number;
  audioCacheSize: number;
  coverCacheSize: number;
  totalSize: number;
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

/** 追加一行诊断日志到 app_data_dir/debug.log（失败静默忽略） */
export function debugLog(message: string): void {
  void invoke("debug_log", { message }).catch(() => undefined);
}

/** 用系统文件管理器打开运行日志目录（app_log_dir，与 tauri-plugin-log 落盘位置一致） */
export async function openLogDir(): Promise<void> {
  await invoke<void>("open_log_dir");
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

export async function cancelDownload(taskId: string): Promise<boolean> {
  return invoke<boolean>("cancel_download", { taskId });
}


/** 写入下载目录里的文本文件，用于同名 LRC 等下载附属文件 */
export async function writeDownloadTextFile(
  directory: string,
  fileName: string,
  contents: string,
): Promise<string> {
  return invoke<string>("write_download_text_file", { directory, fileName, contents });
}

/** 下载普通在线歌曲音频到本地缓存，返回缓存文件路径 */
export async function cacheRemoteAudio(options: RemoteMediaCacheOptions): Promise<string> {
  return invoke<string>("cache_remote_audio", {
    url: options.url,
    cacheKey: options.cacheKey,
  });
}

/** 下载远程封面图到本地缓存，返回缓存文件路径 */
export async function cacheRemoteImage(options: RemoteMediaCacheOptions): Promise<string> {
  return invoke<string>("cache_remote_image", {
    url: options.url,
    cacheKey: options.cacheKey,
  });
}

/** 只查本地媒体缓存，不发起下载；未命中返回 null */
export async function lookupCachedMedia(
  kind: "audio" | "cover",
  cacheKey: string,
): Promise<string | null> {
  return invoke<string | null>("lookup_cached_media", { kind, cacheKey });
}

/** 按 key 删除单条媒体缓存；返回是否真的删掉了文件 */
export async function removeCachedMedia(
  kind: "audio" | "cover",
  cacheKey: string,
): Promise<boolean> {
  return invoke<boolean>("remove_cached_media", { kind, cacheKey });
}

/** 获取歌曲缓存占用大小 */
export async function getSongCacheStats(): Promise<SongCacheStats> {
  return invoke<SongCacheStats>("get_song_cache_stats");
}

/** 清空歌曲文件缓存并返回清理后的占用大小 */
export async function clearSongCache(): Promise<SongCacheStats> {
  return invoke<SongCacheStats>("clear_song_cache");
}

// ─── 用户数据持久化（B-mid） ────────────────────

/** 用户数据命名空间 */
export type LibraryNamespace =
  | "favorites"
  | "playlists"
  | "library"
  | "customSources"
  | "recent"
  | "cache"
  | "dailyRecommend";

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

// ─── 系统媒体控制（SMTC） ────────────────────

/** 系统媒体控制反向控制事件名（Rust 侧 src/smtc.rs 的同名常量必须一致） */
export const SMTC_ACTION_EVENT = "smtc-action";

/** 系统媒体控制能回传的动作 */
export type SmtcActionName = "play" | "pause" | "stop" | "next" | "previous" | "seek";

/** 系统媒体控制反向控制事件载荷（对应 Rust 的 `SmtcActionEvent`） */
export interface SmtcActionEvent {
  action: SmtcActionName;
  /** seek 目标位置（秒），仅 action === "seek" 时存在 */
  position?: number;
}

/** 推给系统的曲目信息（对应 Rust 的 `SmtcTrack`） */
export interface SmtcTrackPayload {
  /** playerStore.status：idle / loading / playing / paused / error */
  status: string;
  title: string;
  artist: string;
  album: string;
  /** 总时长（秒） */
  duration: number;
  /** 当前播放位置（秒） */
  position: number;
  /** 本地封面缓存文件路径；缺失时系统侧只更新文字 */
  coverPath?: string | null;
}

/** 应用「跟随系统媒体控制」开关（关闭时 Rust 侧清空并释放会话） */
export async function smtcSetEnabled(enabled: boolean): Promise<void> {
  await invoke<void>("smtc_set_enabled", { enabled });
}

/** 推送当前曲目 / 播放状态（切歌、暂停恢复、seek 后调用） */
export async function smtcUpdateTrack(track: SmtcTrackPayload): Promise<void> {
  await invoke<void>("smtc_update_track", { track });
}

/** 推送播放进度（Rust 侧按 ≥500ms 节流） */
export async function smtcUpdateProgress(position: number, duration: number): Promise<void> {
  await invoke<void>("smtc_update_progress", { position, duration });
}

// ─── 任务栏缩略图按钮与悬浮预览封面 ────────────────────

/** 任务栏缩略图按钮点击事件名（Rust 侧 src/taskbar.rs 的同名常量必须一致） */
export const TASKBAR_ACTION_EVENT = "taskbar-action";

/** 任务栏缩略图按钮能回传的动作 */
export type TaskbarActionName = "previous" | "playPause" | "next";

/** 任务栏缩略图按钮点击事件载荷（对应 Rust 的 `TaskbarActionEvent`） */
export interface TaskbarActionEvent {
  action: TaskbarActionName;
}

/** 推给任务栏的播放快照（对应 Rust 的 `TaskbarTrack`） */
export interface TaskbarTrackPayload {
  /** playerStore.status：idle / loading / playing / paused / error */
  status: string;
  /** 本地封面缓存文件路径；缺失时悬浮预览保持系统默认 */
  coverPath?: string | null;
}

/** 应用「任务栏缩略图按钮与封面预览」开关（关闭时 Rust 侧卸载窗口过程子类化钩子） */
export async function taskbarSetEnabled(enabled: boolean): Promise<void> {
  await invoke<void>("taskbar_set_enabled", { enabled });
}

/** 推送当前播放状态与封面（切歌、暂停恢复、封面落盘后调用） */
export async function taskbarUpdateTrack(track: TaskbarTrackPayload): Promise<void> {
  await invoke<void>("taskbar_update_track", { track });
}

/** 只读取本地 ReplayGain 文本标签，不搬运封面或歌词。 */
export async function getAudioReplayGain(path: string): Promise<{ gainDb: number; peak?: number | null } | null> {
  return invoke("get_audio_replay_gain", { path });
}

/** 保存用户选定的封面原始字节，独立于可清理的自动缓存。 */
export async function saveManualCover(dataUrl: string): Promise<string> {
  return invoke("save_manual_cover", { dataUrl });
}
