import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("settings version integration", () => {
  it("shows the current mobile app version in Settings", () => {
    const settingsSource = readFileSync(
      resolve(process.cwd(), "src/screens/settings/AboutSettingsScreen.tsx"),
      "utf8",
    );
    const updateServiceSource = readFileSync(
      resolve(process.cwd(), "src/services/updateService.ts"),
      "utf8",
    );

    expect(updateServiceSource).toContain("export const CURRENT_VERSION");
    expect(settingsSource).toContain("CURRENT_VERSION");
    expect(settingsSource).toContain("当前版本");
  });
});
