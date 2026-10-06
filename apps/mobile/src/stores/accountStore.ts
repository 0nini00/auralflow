import { create } from "zustand";
import type { WyUserInfo } from "../services/wyAccountService";
import {
  loginWithCookie,
  checkLoginStatus,
  clearWyAccount,
  getWyCookie,
} from "../services/wyAccountService";

export interface AccountState {
  isLoggedIn: boolean;
  user: WyUserInfo | null;
  loading: boolean;
  error: string | null;
}

interface AccountActions {
  login: (cookie: string) => Promise<void>;
  logout: () => Promise<void>;
  checkStatus: () => Promise<void>;
  getCookie: () => Promise<string | null>;
}

type AccountStore = AccountState & AccountActions;

export const useAccountStore = create<AccountStore>((set) => ({
  isLoggedIn: false,
  user: null,
  loading: false,
  error: null,

  login: async (cookie: string) => {
    set({ loading: true, error: null });
    const request = loginWithCookie(cookie);
    try {
      const user = await request;
      if (!request.isCurrent()) throw new Error("账号登录已被后续操作取代");
      set({
        isLoggedIn: true,
        user,
        loading: false,
      });
    } catch (error) {
      if (!request.isCurrent()) throw error;
      const message = error instanceof Error ? error.message : "登录失败";
      set({
        error: message,
        loading: false,
      });
      throw error;
    }
  },

  logout: async () => {
    set({ loading: true, error: null });
    const request = clearWyAccount();
    try {
      await request;
      if (!request.isCurrent()) throw new Error("账号退出已被后续操作取代");
      set({
        isLoggedIn: false,
        user: null,
        loading: false,
      });
    } catch (error) {
      if (!request.isCurrent()) throw error;
      const message = error instanceof Error ? error.message : "退出账号失败";
      set({ error: message, loading: false });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  checkStatus: async () => {
    set({ loading: true, error: null });
    const request = checkLoginStatus();
    try {
      const status = await request;
      if (!request.isCurrent()) return;
      if (!status.isLoggedIn) {
        set({
          isLoggedIn: false,
          user: null,
          loading: false,
        });
        return;
      }

      set({
        isLoggedIn: true,
        user: status.user,
        loading: false,
      });
    } catch (error) {
      if (!request.isCurrent()) return;
      const message = error instanceof Error ? error.message : "账号状态检查失败";
      set({
        error: message,
        loading: false,
      });
    }
  },

  getCookie: async () => {
    return await getWyCookie();
  },
}));
