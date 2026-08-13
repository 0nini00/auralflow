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
    try {
      const user = await loginWithCookie(cookie);
      set({
        isLoggedIn: true,
        user,
        loading: false,
      });
    } catch (error) {
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
    try {
      await clearWyAccount();
      set({
        isLoggedIn: false,
        user: null,
        loading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "退出账号失败";
      set({ error: message, loading: false });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  checkStatus: async () => {
    set({ loading: true, error: null });
    try {
      const status = await checkLoginStatus();
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
