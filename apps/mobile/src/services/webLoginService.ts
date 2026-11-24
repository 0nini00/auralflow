import { NativeModules, Platform } from "react-native";

interface WebLoginNativeModule {
  readCookie(url: string): Promise<string | null>;
}

const nativeModule = NativeModules.WebLoginModule as WebLoginNativeModule | undefined;

/** 读取内置网页登录后 WebView CookieManager 里的网易云登录 Cookie。 */
export async function readNeteaseWebLoginCookie(): Promise<string | null> {
  if (Platform.OS !== "android") return null;
  if (!nativeModule?.readCookie) {
    throw new Error("网页登录模块不可用，请安装包含 WebLoginModule 的新版应用");
  }
  for (const url of ["https://music.163.com", "http://music.163.com"]) {
    const cookie = await nativeModule.readCookie(url);
    if (cookie && /(?:^|;\s*)MUSIC_U=/.test(cookie)) return cookie;
  }
  return null;
}
