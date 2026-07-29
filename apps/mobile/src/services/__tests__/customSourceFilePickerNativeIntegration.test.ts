import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("custom source file picker native integration", () => {
  it("registers the Android custom source file picker module", () => {
    const packageSource = readFileSync(
      resolve(process.cwd(), "android/app/src/main/java/cn/chenle/auralflow/mobile/LocalMusicPackage.java"),
      "utf8",
    );
    const moduleSource = readFileSync(
      resolve(process.cwd(), "android/app/src/main/java/cn/chenle/auralflow/mobile/CustomSourceFilePickerModule.java"),
      "utf8",
    );

    expect(packageSource).toContain("modules.add(new CustomSourceFilePickerModule(reactContext));");
    expect(moduleSource).toContain("return \"CustomSourceFilePickerModule\";");
    expect(moduleSource).toContain("Intent.ACTION_OPEN_DOCUMENT");
    expect(moduleSource).toContain("promise.resolve(uri.toString());");
  });
});
