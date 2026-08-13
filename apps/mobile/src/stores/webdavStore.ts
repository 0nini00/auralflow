import { create } from "zustand";
import {
  loadWebdavConfig,
  saveWebdavConfig,
  testSync as testSyncService,
  uploadPlaylistsSync,
  downloadPlaylistsSync,
  uploadSourcesSync,
  downloadSourcesSync,
  autoSyncPlaylistsOnce as autoSyncPlaylistsService,
  type WebdavConfig,
} from "../services/webdavSyncService";

const CONFIG_KEY = "auralflow.mobile.webdavConfig";

interface WebdavState {
  url: string;
  username: string;
  password: string;
  autoSyncPlaylists: boolean;
  loaded: boolean;
  /** 同步操作进行中 */
  syncing: boolean;
  /** 最近一次操作的消息（成功/失败提示） */
  message: string;
}

interface WebdavActions {
  loadConfig: () => Promise<void>;
  setConfig: (cfg: Partial<Pick<WebdavConfig, "url" | "username" | "password">>) => Promise<void>;
  setAutoSyncPlaylists: (enabled: boolean) => Promise<void>;
  autoSyncPlaylistsOnce: () => Promise<void>;
  clearMessage: () => void;
  testSync: () => Promise<void>;
  uploadPlaylists: () => Promise<void>;
  /** force=true 时跳过“云端较旧”拦截，强制下载（对齐桌面端）。 */
  downloadPlaylists: (force?: boolean) => Promise<void>;
  uploadSources: () => Promise<void>;
  /** force=true 时跳过“云端较旧”拦截，强制下载（对齐桌面端）。 */
  downloadSources: (force?: boolean) => Promise<void>;
}

type WebdavStore = WebdavState & WebdavActions;

let autoSyncPromise: Promise<void> | null = null;

export const useWebdavStore = create<WebdavStore>((set, get) => ({
  url: "",
  username: "",
  password: "",
  autoSyncPlaylists: false,
  loaded: false,
  syncing: false,
  message: "",

  loadConfig: async () => {
    try {
      const cfg = await loadWebdavConfig();
      const autoSyncPlaylists =
        cfg.autoSyncPlaylists &&
        Boolean(cfg.url.trim()) &&
        Boolean(cfg.username.trim()) &&
        Boolean(cfg.password);
      set({
        url: cfg.url,
        username: cfg.username,
        password: cfg.password,
        autoSyncPlaylists,
        loaded: true,
      });
      if (cfg.autoSyncPlaylists !== autoSyncPlaylists) {
        await saveWebdavConfig({ ...cfg, autoSyncPlaylists });
      }
    } catch (error) {
      set({ loaded: true });
    }
  },

  setConfig: async (cfg) => {
    const state = get();
    const url = cfg.url ?? state.url;
    const username = cfg.username ?? state.username;
    const password = cfg.password ?? state.password;
    const next = {
      url,
      username,
      password,
      autoSyncPlaylists:
        state.autoSyncPlaylists &&
        Boolean(url.trim()) &&
        Boolean(username.trim()) &&
        Boolean(password),
    };
    await saveWebdavConfig(next);
    set(next);
  },

  setAutoSyncPlaylists: async (enabled) => {
    const state = get();
    const hasCompleteConfig =
      Boolean(state.url.trim()) &&
      Boolean(state.username.trim()) &&
      Boolean(state.password);
    if (enabled && !hasCompleteConfig) {
      set({ autoSyncPlaylists: false, message: "请先填写 WebDAV 地址、用户名和密码" });
      return;
    }

    const next = {
      url: state.url,
      username: state.username,
      password: state.password,
      autoSyncPlaylists: enabled,
    };
    await saveWebdavConfig(next);
    set({ autoSyncPlaylists: enabled });
  },

  autoSyncPlaylistsOnce: () => {
    if (autoSyncPromise) return autoSyncPromise;
    autoSyncPromise = (async () => {
      set({ syncing: true, message: "" });
      let message = "歌单历史自动同步成功";
      try {
        await autoSyncPlaylistsService();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        message = `WebDAV 网络同步失败：${detail}`;
      } finally {
        // 完成后重置单飞缓存：仅防并发重入；首次失败（如启动时离线）后允许下次重试
        autoSyncPromise = null;
        set({ syncing: false, message });
      }
    })();
    return autoSyncPromise;
  },

  clearMessage: () => set({ message: "" }),

  testSync: async () => {
    set({ syncing: true, message: "" });
    try {
      const result = await testSyncService();
      set({
        syncing: false,
        message: result === "连接正常" ? result : `WebDAV 网络连接测试失败：${result}`,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      set({
        syncing: false,
        message: `WebDAV 网络连接测试失败：${detail}`,
      });
    }
  },

  uploadPlaylists: async () => {
    set({ syncing: true, message: "" });
    try {
      await uploadPlaylistsSync();
      set({ syncing: false, message: "歌单上传成功" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      set({
        syncing: false,
        message: `WebDAV 网络上传失败：${detail}`,
      });
    }
  },

  downloadPlaylists: async (force) => {
    set({ syncing: true, message: "" });
    try {
      await downloadPlaylistsSync({ force });
      set({ syncing: false, message: "歌单下载成功" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      set({
        syncing: false,
        message: `WebDAV 网络下载失败：${detail}`,
      });
      // 重新抛出，供 UI 识别“云端较旧”并引导强制下载
      throw error;
    }
  },

  uploadSources: async () => {
    set({ syncing: true, message: "" });
    try {
      await uploadSourcesSync();
      set({ syncing: false, message: "音源上传成功" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      set({
        syncing: false,
        message: `WebDAV 网络上传失败：${detail}`,
      });
    }
  },

  downloadSources: async (force) => {
    set({ syncing: true, message: "" });
    try {
      await downloadSourcesSync({ force });
      set({ syncing: false, message: "音源下载成功" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      set({
        syncing: false,
        message: `WebDAV 网络下载失败：${detail}`,
      });
      // 重新抛出，供 UI 识别“云端较旧”并引导强制下载
      throw error;
    }
  },
}));

/** 供 webdavSyncService 使用的配置存储键（保持与 service 一致）。 */
export const WEBDAV_CONFIG_KEY = CONFIG_KEY;
