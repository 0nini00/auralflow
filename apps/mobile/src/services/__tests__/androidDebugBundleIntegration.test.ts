import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Android debug bundle integration", () => {
  it("bundles the current JavaScript sources into every debug APK", () => {
    const buildGradle = readFileSync(
      resolve(process.cwd(), "android/app/build.gradle"),
      "utf8",
    );

    expect(buildGradle).toContain("debuggableVariants = []");
    expect(
      existsSync(
        resolve(
          process.cwd(),
          "android/app/src/main/assets/index.android.bundle",
        ),
      ),
    ).toBe(false);
  });

  it("canonicalizes Metro roots when Gradle runs through a short drive", () => {
    const metroConfig = readFileSync(
      resolve(process.cwd(), "metro.config.js"),
      "utf8",
    );

    expect(metroConfig).toContain("fs.realpathSync.native(__dirname)");
    expect(metroConfig).toContain("getDefaultConfig(appRoot)");
    expect(metroConfig).toContain("function canonicalizeExistingPaths(value)");
    expect(metroConfig).toContain(
      "canonicalizeExistingPaths(getDefaultConfig(appRoot))",
    );
    expect(metroConfig).toContain(
      "defaultConfig.serializer.getPolyfills = (...args) =>",
    );

    const babelConfig = readFileSync(
      resolve(process.cwd(), "babel.config.js"),
      "utf8",
    );
    expect(babelConfig).not.toContain("module-resolver");
  });
});
