import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "auralflow.mobile.chkszApiKey";

interface ApiKeyStore {
  /** ChKSz API Key（https://api.chksz.com 登录后获取），空串表示未配置。 */
  chkszApiKey: string;
  loaded: boolean;
  loadFromStorage: () => Promise<void>;
  setChkszApiKey: (key: string) => Promise<void>;
}

export const useApiKeyStore = create<ApiKeyStore>((set) => ({
  chkszApiKey: "",
  loaded: false,

  loadFromStorage: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      set({ chkszApiKey: raw ?? "", loaded: true });
    } catch (error) {
      set({ loaded: true });
    }
  },

  setChkszApiKey: async (key: string) => {
    const trimmed = key.trim();
    set({ chkszApiKey: trimmed });
    try {
      if (trimmed) {
        await AsyncStorage.setItem(STORAGE_KEY, trimmed);
      } else {
        await AsyncStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
  },
}));
