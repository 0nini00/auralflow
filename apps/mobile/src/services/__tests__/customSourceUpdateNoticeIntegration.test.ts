import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("custom source update notice integration", () => {
  const componentPath = resolve(process.cwd(), "src/components/CustomSourceUpdateModal.tsx");
  const appPath = resolve(process.cwd(), "App.tsx");

  it("has a global mobile custom source update modal", () => {
    expect(existsSync(componentPath)).toBe(true);

    const source = readFileSync(componentPath, "utf8");
    expect(source).toContain("selectCustomSourceUpdateNotice");
    expect(source).toContain("buildCustomSourceUpdateDismissKey");
    expect(source).toContain("getCustomSourceUpdateLog");
    expect(source).toContain("Linking.openURL(source.updateUrl)");
    expect(source).toContain("打开更新地址");
  });

  it("mounts the custom source update modal at the app shell level", () => {
    const appSource = readFileSync(appPath, "utf8");
    expect(appSource).toContain("import { CustomSourceUpdateModal } from \"@/components/CustomSourceUpdateModal\";");
    expect(appSource).toContain("<CustomSourceUpdateModal />");
  });
});
