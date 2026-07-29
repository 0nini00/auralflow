import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readProjectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("mobile deep link integration", () => {
  it("registers the auralflow scheme for Android", () => {
    const manifest = readProjectFile("android/app/src/main/AndroidManifest.xml");

    expect(manifest).toContain('<data android:scheme="auralflow" />');
    expect(manifest).toContain("android.intent.action.VIEW");
    expect(manifest).toContain("android.intent.category.BROWSABLE");
  });

  it("handles cold-start and runtime deep links in the app shell", () => {
    const appSource = readProjectFile("App.tsx");

    expect(appSource).toContain("Linking");
    expect(appSource).toContain("parseMobileDeepLink");
    expect(appSource).toContain("Linking.getInitialURL()");
    expect(appSource).toContain('Linking.addEventListener("url"');
  });

  it("routes deep link intents into drawer screens (not Home mode state)", () => {
    const appSource = readProjectFile("App.tsx");
    const homeSource = readProjectFile("src/screens/HomeScreen.tsx");
    const drawerSource = readProjectFile("src/navigation/MainDrawerNavigator.tsx");
    const searchSource = readProjectFile("src/screens/SearchScreen.tsx");

    // 深链通过 navigationRef 直达独立路由
    expect(appSource).toContain('screen: intent.mode === "fm" ? "FM" : "Daily"');
    expect(appSource).toContain('screen: "Search"');
    expect(appSource).toContain("initialKeyword: intent.keyword");
    expect(appSource).toContain("initialDetailRoute: intent.route");

    // Home 不再承载 daily/fm mode 内嵌
    expect(homeSource).not.toContain("HomeMode");
    expect(homeSource).not.toContain("setMode(initialMode)");
    expect(homeSource).toContain("onNavigateToFm");

    // 抽屉有独立 Daily / FM 路由
    expect(drawerSource).toContain('name="Daily"');
    expect(drawerSource).toContain('name="FM"');
    expect(drawerSource).toContain("onNavigateToFm");

    // Search 仍接收 initialKeyword / initialDetailRoute
    expect(searchSource).toContain("initialKeyword?: string | null");
    expect(searchSource).toContain("initialDetailRoute?: SearchDetailRoute | null");
  });
});
