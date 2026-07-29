import { beforeEach, describe, expect, it, vi } from "vitest";

const reactNative = vi.hoisted(() => ({
  NativeModules: {
    CustomSourceFilePickerModule: {
      pickCustomSourceScriptFile: vi.fn(() => Promise.resolve("content://source/script.js")),
    },
  },
  Platform: {
    OS: "android",
  },
}));

vi.mock("react-native", () => reactNative);

describe("custom source file picker", () => {
  beforeEach(() => {
    reactNative.Platform.OS = "android";
    reactNative.NativeModules.CustomSourceFilePickerModule.pickCustomSourceScriptFile.mockReset();
    reactNative.NativeModules.CustomSourceFilePickerModule.pickCustomSourceScriptFile.mockResolvedValue(
      "content://source/script.js",
    );
  });

  it("returns the Android document URI selected by the native picker", async () => {
    const { pickCustomSourceScriptFile } = await import("@/services/customSourceFilePicker");

    await expect(pickCustomSourceScriptFile()).resolves.toBe("content://source/script.js");
    expect(reactNative.NativeModules.CustomSourceFilePickerModule.pickCustomSourceScriptFile).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when the native picker module is not registered", async () => {
    const original = reactNative.NativeModules.CustomSourceFilePickerModule;
    (reactNative.NativeModules as any).CustomSourceFilePickerModule = undefined;
    vi.resetModules();

    const { pickCustomSourceScriptFile } = await import("@/services/customSourceFilePicker");

    await expect(pickCustomSourceScriptFile()).rejects.toThrow("Android 自定义音源文件选择模块未注册");
    reactNative.NativeModules.CustomSourceFilePickerModule = original;
  });
});
