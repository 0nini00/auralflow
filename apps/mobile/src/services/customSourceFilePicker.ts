import { NativeModules, Platform } from "react-native";

interface CustomSourceFilePickerNativeModule {
  pickCustomSourceScriptFile(): Promise<string | null>;
}

const nativeFilePicker = NativeModules.CustomSourceFilePickerModule as
  | CustomSourceFilePickerNativeModule
  | undefined;

export async function pickCustomSourceScriptFile(): Promise<string | null> {
  if (Platform.OS !== "android") {
    throw new Error("自定义音源文件导入当前仅支持 Android");
  }

  if (
    !nativeFilePicker ||
    typeof nativeFilePicker.pickCustomSourceScriptFile !== "function"
  ) {
    throw new Error(
      "Android 自定义音源文件选择模块未注册。请重新编译原生工程：cd apps/mobile/android && ./gradlew clean && ./gradlew assembleDebug",
    );
  }

  return nativeFilePicker.pickCustomSourceScriptFile();
}
