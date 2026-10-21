import { create } from "zustand";

/**
 * 纯界面状态（不落盘、不进业务层）。
 *
 * 「正在播放」右栏由顶栏与播放条两处入口控制，而播放条渲染在工作区之外，
 * 所以状态放在这里，避免把 Layout 的 state 一层层传下去。
 */
interface UiStore {
  nowPlayingOpen: boolean;
  setNowPlayingOpen: (open: boolean) => void;
  toggleNowPlaying: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  nowPlayingOpen: false,
  setNowPlayingOpen: (open) => set({ nowPlayingOpen: open }),
  toggleNowPlaying: () => set((state) => ({ nowPlayingOpen: !state.nowPlayingOpen })),
}));
