import { create } from "zustand";
import type { UpdateAvailable } from "@/services/updateService";

/**
 * 待展示的可用更新。
 *
 * 全局单例：启动时的静默检查（`App.tsx`）与设置页的手动检查
 * （`views/settings/MiscSettingsSection.tsx`）都会写它，`UpdateModal` 读它。
 * 不用 props 层层传，是因为这两个触发点分处组件树的远两端。
 */
interface UpdateStoreState {
  available: UpdateAvailable | null;
  setAvailable: (info: UpdateAvailable | null) => void;
}

export const useUpdateStore = create<UpdateStoreState>()((set) => ({
  available: null,
  setAvailable: (available) => set({ available }),
}));
