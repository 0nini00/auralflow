import { create } from "zustand";

interface SearchQueryState {
  /** 最近一次成功发起的搜索关键词，供其它视图（如搜索结果页）读取 */
  lastKeyword: string;
  setLastKeyword: (kw: string) => void;
}

/**
 * 全局搜索关键词 store。
 * 仅做轻量对齐：把当前搜索词回写到 App 状态，
 * 让搜索结果页 / 其它视图能读到当前搜索词（移动端无地址栏，等效于桌面 URL 同步）。
 */
export const useSearchQueryStore = create<SearchQueryState>((set) => ({
  lastKeyword: "",
  setLastKeyword: (kw) => set({ lastKeyword: kw }),
}));
