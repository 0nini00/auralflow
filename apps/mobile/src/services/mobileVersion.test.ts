import { describe, expect, it } from "vitest";
import mobilePackage from "../../package.json";
import { ANDROID_VERSION_CODE, CURRENT_VERSION } from "./mobileVersion";

describe("mobile version source", () => {
  it("应用内版本读取 package.json", () => {
    expect(CURRENT_VERSION).toBe(mobilePackage.version);
  });

  it("Android versionCode 为正整数", () => {
    expect(Number.isInteger(ANDROID_VERSION_CODE)).toBe(true);
    expect(ANDROID_VERSION_CODE).toBeGreaterThan(0);
  });
});
