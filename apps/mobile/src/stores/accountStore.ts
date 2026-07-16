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
    set({ loading: true });
    try {
      await clearWyAccount();
      set({
        isLoggedIn: false,
        user: null,
        loading: false,
      });
    } catch (error) {
      console.error("Logout error:", error);
      set({ loading: false });
    }
  },

  checkStatus: async () => {
    set({ loading: true });
    try {
      const { isLoggedIn, user } = await checkLoginStatus();
      set({
        isLoggedIn,
        user,
        loading: false,
      });
    } catch (error) {
      console.error("Check status error:", error);
      set({ loading: false });
    }
  },

  getCookie: async () => {
    return await getWyCookie();
  },
}));
