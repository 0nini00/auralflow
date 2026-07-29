import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => {
  const absolutePath = resolve(process.cwd(), path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
};

describe("app shell integration", () => {
  it("moves chrome composition out of App.tsx", () => {
    const app = read("App.tsx");

    expect(app).toContain('import { AppShell } from "@/components/AppShell"');
    expect(app).toContain("<AppShell>");
    expect(app).not.toContain("function AppChrome");
    expect(app).not.toContain("<MiniPlayer");
  });

  it("uses normal flow for header, content, and player", () => {
    const shell = read("src/components/AppShell.tsx");

    expect(shell.indexOf("<AppHeader")).toBeLessThan(shell.indexOf("styles.content"));
    expect(shell.indexOf("<PlayerBar")).toBeGreaterThan(shell.indexOf("styles.content"));
    expect(shell).not.toContain('position: "absolute"');
  });

  it("handles explicit and Android back through pending replay intent", () => {
    const shell = read("src/components/AppShell.tsx");

    expect(shell).toContain("pendingReplayRef");
    expect(shell).toContain('BackHandler.addEventListener("hardwareBackPress"');
    expect(shell).toContain("getDrawerStatusFromState");
    expect(shell).toContain("DrawerActions.closeDrawer()");
    expect(shell).toContain("transition.pendingReplay");
    expect(shell).toContain("params: target.params");
    expect(shell).toContain("return false");
  });

  it("renders search suggestion failures instead of silently clearing them", () => {
    const header = read("src/components/AppHeader.tsx");

    expect(header).toContain("suggestionError");
    expect(header).toContain("搜索建议加载失败");
    expect(header).not.toContain(".catch(() => setSuggestions([]))");
  });

  it("does not clear library route params through an inline callback", () => {
    const drawer = read("src/navigation/MainDrawerNavigator.tsx");
    const library = read("src/screens/LibraryScreen.tsx");

    expect(drawer).not.toContain("onInitialSectionConsumed");
    expect(library).not.toContain("setActiveSection");
    expect(library).not.toContain("onInitialSectionConsumed");
  });

  it("closes the deepest open drawer before replaying global history", () => {
    const shell = read("src/components/AppShell.tsx");

    expect(shell).toContain("function findOpenDrawerKey");
    expect(shell).toContain("const nestedKey = findOpenDrawerKey(nested)");
    expect(shell).toContain("target: openDrawerKey");
  });
});
