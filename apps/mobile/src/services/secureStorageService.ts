import { NativeModules, Platform } from "react-native";

interface SecureStorageNativeModule {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const nativeModule = NativeModules.SecureStorageModule as SecureStorageNativeModule | undefined;

function getNativeModule(): SecureStorageNativeModule {
  if (Platform.OS !== "android" || !nativeModule) {
    throw new Error("Android SecureStorageModule 未注册，请重新编译原生工程");
  }
  return nativeModule;
}

export function getSecureItem(key: string): Promise<string | null> {
  return getNativeModule().getItem(key);
}

export function setSecureItem(key: string, value: string): Promise<void> {
  return getNativeModule().setItem(key, value);
}

export function removeSecureItem(key: string): Promise<void> {
  return getNativeModule().removeItem(key);
}
