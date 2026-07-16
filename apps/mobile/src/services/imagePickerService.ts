import { NativeModules } from "react-native";

interface ImagePickerModule {
  pickImage(): Promise<string | null>;
  releaseImagePermission(uri: string): Promise<boolean>;
}

const nativeModule: ImagePickerModule | undefined = NativeModules.ImagePickerModule;

/**
 * 打开系统图片选择器；用户取消返回 null，成功返回可长期访问的 content:// URI。
 * URI 通过 takePersistableUriPermission 授权，App 重启后仍可读。
 */
export async function pickImageFromGallery(): Promise<string | null> {
  if (!nativeModule) {
    throw new Error("ImagePickerModule 未注册，请重新构建 Android 工程");
  }
  return nativeModule.pickImage();
}

/**
 * 释放先前 takePersistableUriPermission 拿到的 URI 权限。
 * 失败静默返回 false，不影响调用方状态清理。
 */
export async function releasePersistedImageUri(uri: string): Promise<boolean> {
  if (!nativeModule) return false;
  try {
    return await nativeModule.releaseImagePermission(uri);
  } catch {
    return false;
  }
}
