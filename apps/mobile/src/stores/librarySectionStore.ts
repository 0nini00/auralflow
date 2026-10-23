import { create } from "zustand";

/**
 * 音乐库分段：歌单 / 本地 / 收藏 / 历史 / 下载。
 *
 * 用 store 而不是路由参数：首页快捷入口、播放历史入口、深链都通过
 * `openLibrarySection()` 写入同一个 section，再切到音乐库 Tab；
 * 这样重复点同一入口也能重新定位，不受嵌套 navigate 参数合并影响。
 */
export type LibrarySection = "playlists" | "local" | "favorites" | "history" | "downloads";

interface LibrarySectionState {
  section: LibrarySection;
  requestSection: (section: LibrarySection) => void;
}

export const useLibrarySectionStore = create<LibrarySectionState>((set) => ({
  section: "playlists",
  requestSection: (section) => set({ section }),
}));
