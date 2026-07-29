import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("custom source file import integration", () => {
  const screenSource = readFileSync(
    resolve(process.cwd(), "src/screens/CustomSourceScreen.tsx"),
    "utf8",
  );

  it("wires the desktop file-import flow into the mobile custom source screen", () => {
    expect(screenSource).toContain("import { pickCustomSourceScriptFile } from \"@/services/customSourceFilePicker\";");
    expect(screenSource).toContain("const importFromFile = useCustomSourceStore((state) => state.importFromFile);");
    expect(screenSource).toContain("const handleImportFromFile = async () => {");
    expect(screenSource).toContain("const filePath = await pickCustomSourceScriptFile();");
    expect(screenSource).toContain("const item = await importFromFile(filePath);");
    expect(screenSource).toContain("从文件导入");
  });
});
