import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => {
  const absolutePath = resolve(process.cwd(), path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
};

describe("app sidebar integration", () => {
  it("uses the real logo and closes before navigation", () => {
    const sidebar = read("src/components/AppSidebar.tsx");
    const drawer = read("src/navigation/MainDrawerNavigator.tsx");

    expect(sidebar).toContain("<Image");
    expect(sidebar).toContain('require("../assets/logo.png")');
    expect(sidebar).not.toContain(">AF</Text>");
    const closeIndex = drawer.indexOf("closeDrawer()");
    const navigateIndex = drawer.indexOf("navigate(tabIdToDrawerRoute(id))");
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(navigateIndex).toBeGreaterThanOrEqual(0);
    expect(closeIndex).toBeLessThan(navigateIndex);
  });

  it("uses the shared application tabs as its navigation source", () => {
    const sidebar = read("src/components/AppSidebar.tsx");

    expect(sidebar).toContain("APP_TABS.map(renderItem)");
    expect(sidebar).toContain("renderItem(APP_SETTINGS_TAB)");
  });
});
