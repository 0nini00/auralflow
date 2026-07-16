import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 行为契约：移动端首页搜索入口。
 * - HomeScreen 必须声明 onNavigateToSearch 回调 prop
 * - 搜索入口必须带 accessibilityLabel="搜索音乐"
 * - App 壳层必须把搜索跳转接入 navigationRef (navigate("Main", { screen: "Search" }))
 */
describe("home search entry integration", () => {
  const homeSource = readFileSync(
    resolve(process.cwd(), "src/screens/HomeScreen.tsx"),
    "utf8",
  );
  const appSource = readFileSync(resolve(process.cwd(), "App.tsx"), "utf8");
  const shellSource = readFileSync(
    resolve(process.cwd(), "src/components/AppShell.tsx"),
    "utf8",
  );

  it("declares onNavigateToSearch as a required prop on HomeScreen", () => {
    expect(homeSource).toContain("onNavigateToSearch");
    expect(homeSource).toContain('accessibilityLabel="搜索音乐"');
  });

  it("routes search navigation through the drawer shell", () => {
    expect(shellSource).toContain('screen: "Search"');
    expect(shellSource).toContain("submitSearch");
    expect(appSource).not.toContain("submitSearch");
  });
});
