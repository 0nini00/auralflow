import { hashLocalFile } from '@lx/tauri-bridge';
import { useLibraryStore } from '@/stores/libraryStore';
import {
  buildLocalLyricsChoicePatch,
  buildLocalLyricsFingerprint,
  type LocalLyricsChoiceRequest,
} from '@/services/localLyricsChoiceModel';
import type { LocalSong } from '@/services/localMusicService';

/**
 * 计算这次选择要绑定的指纹。
 *
 * 只在用户做出选择的那一刻算一次：整文件 md5 是一次完整读盘，扫库与播放路径都不许碰它
 * （见设计里「指纹只在用户做出选择时算一次」）。指纹串里带上此刻记录里的 `size`，
 * 之后重新扫描刷新 size 就能发现内容变了。
 *
 * 交给 Rust 的 `hash_local_file` 而不是在 TS 侧实现：仓库里已有 `md5` crate，
 * 不必新增依赖，也不必把一个几十 MB 的文件读进 JS 堆。
 */
export async function computeLocalLyricsFingerprint(
  song: Pick<LocalSong, 'path' | 'size'>,
): Promise<string> {
  const contentHash = await hashLocalFile(song.path);
  return buildLocalLyricsFingerprint(song.size, contentHash);
}

/**
 * 把选择写进曲库记录（library 命名空间，落盘由 libraryPersistence 完成）。
 *
 * 走 updateSong 而不是另存一份：记录是唯一真相源，重新扫描的合并也只看记录本身
 * （见 libraryRefreshModel：扫描结果不会覆盖记录上的歌词选择字段）。
 */
export function applyLocalLyricsChoice(
  song: Pick<LocalSong, 'id'>,
  request: LocalLyricsChoiceRequest,
): void {
  useLibraryStore.getState().updateSong(song.id, buildLocalLyricsChoicePatch(request));
}
