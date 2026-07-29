import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readScreen(name: string): string {
  return readFileSync(resolve(process.cwd(), `src/screens/${name}`), "utf8");
}

describe("content description integration", () => {
  it("uses the shared collapsed description model in album detail", () => {
    const source = readScreen("AlbumDetailScreen.tsx");

    expect(source).toContain("import { buildContentDescriptionModel } from \"@/services/contentDescriptionModel\";");
    expect(source).toContain("const descriptionModel = buildContentDescriptionModel(albumDescription, descriptionExpanded);");
    expect(source).toContain("numberOfLines={descriptionModel.numberOfLines}");
    expect(source).toContain("{descriptionModel.toggleLabel}");
  });

  it("uses the shared collapsed description model in artist detail", () => {
    const source = readScreen("ArtistDetailScreen.tsx");

    expect(source).toContain("import { buildContentDescriptionModel } from \"@/services/contentDescriptionModel\";");
    expect(source).toContain("const descriptionModel = buildContentDescriptionModel(artistBriefDesc, descriptionExpanded);");
    expect(source).toContain("numberOfLines={descriptionModel.numberOfLines}");
    expect(source).toContain("{descriptionModel.toggleLabel}");
  });
});
