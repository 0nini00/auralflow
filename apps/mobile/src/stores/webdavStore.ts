import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  loadWebdavConfig,
  saveWebdavConfig,
  testSync as testSyncService,
  uploadPlaylistsSync,
  downloadPlaylistsSync,
  uploadSourcesSync,
  downloadSourcesSync,
  type WebdavConfig,
} from "../services/webdavSyncService";

const CONFIG_KEY = "auralflow.mobile.webdavConfig";

interface WebdavState {
  url: string;
  username: string;
  password: string;
  loaded: boolean;
  /** 同步操作进行中 */
  syncing: boolean;
  /** 最近一次操作的消息（成功/失败提示） */
  message: string;
}

interface WebdavActions {
  loadConfig: () => Promise<void>;
  setConfig: (cfg: Partial<Pick<WebdavConfig, "url" | "username" | "password">>) => Promise<void>;
  clearMessage: () => void;
  testSync: () => Promise<void>;
  uploadPlaylists: () => Promise<void>;
  downloadPlaylists: () => Promise<void>;
  uploadSources: () => Promise<void>;
  downloadSources: () => Promise<void>;
}

type WebdavStore = WebdavState & WebdavActions;

export const useWebdavStore = create<WebdavStore>((set, get) => ({
  url: "",
  username: "",
  password: "",
  loaded: false,
  syncing: false,
  message: "",

  loadConfig: async () => {
    try {
      const cfg = await loadWebdavConfig();
      set({
        url: cfg.url,
        username: cfg.username,
        password: cfg.password,
        loaded: true,
      });
    } catch (error) {
      console.error("Load webdav config error:", error);
      set({ loaded: true });
    }
  },

  setConfig: async (cfg) => {
    const next = {
      url: cfg.url ?? get().url,
      username: cfg.username ?? get().username,
      password: cfg.password ?? get().password,
    };
    set(next);
    try {
      await saveWebdavConfig(next);
    } catch (error) {
      console.error("Save webdav config error:", error);
    }
  },

  clearMessage: () => set({ message: "" }),

  testSync: async () => {
    set({ syncing: true, message: "" });
    try {
      const result = await testSyncService();
      set({ syncing: false, message: result });
    } catch (error) {
      set({
        syncing: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  uploadPlaylists: async () => {
    set({ syncing: true, message: "" });
    try {
      await uploadPlaylistsSync();
      set({ syncing: false, message: "歌单上传成功" });
    } catch (error) {
      set({
        syncing: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  downloadPlaylists: async () => {
    set({ syncing: true, message: "" });
    try {
      await downloadPlaylistsSync();
      set({ syncing: false, message: "歌单下载成功" });
    } catch (error) {
      set({
        syncing: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  uploadSources: async () => {
    set({ syncing: true, message: "" });
    try {
      await uploadSourcesSync();
      set({ syncing: false, message: "音源上传成功" });
    } catch (error) {
      set({
        syncing: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  downloadSources: async () => {
    set({ syncing: true, message: "" });
    try {
      await downloadSourcesSync();
      set({ syncing: false, message: "音源下载成功" });
    } catch (error) {
      set({
        syncing: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));

/** 供 webdavSyncService 使用的配置存储键（保持与 service 一致）。 */
export const WEBDAV_CONFIG_KEY = CONFIG_KEY;
