import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("local playlist list management integration", () => {
  it("wires desktop-equivalent local playlist actions into the library list", () => {
    const librarySource = readSource("src/screens/LibraryScreen.tsx");
    const listSource = readSource("src/components/LocalPlaylistList.tsx");

    expect(librarySource).toContain("shareExportedLocalPlaylists");
    expect(librarySource).toContain("shareExportedPlaylists");
    expect(librarySource).toContain("buildLocalPlaylistListActionRequest");
    expect(librarySource).toContain("const [editingLocalPlaylistId, setEditingLocalPlaylistId] = useState<string | null>(null);");
    expect(librarySource).toContain("const handleLocalPlaylistAction = async (");
    expect(librarySource).toContain("case \"edit\":");
    expect(librarySource).toContain("case \"duplicate\":");
    expect(librarySource).toContain("case \"export\":");
    expect(librarySource).toContain("case \"delete\":");
    expect(librarySource).toContain("onAction={handleLocalPlaylistAction}");

    expect(listSource).toContain("LOCAL_PLAYLIST_LIST_ACTIONS");
    expect(listSource).toContain("onAction?: (playlist: LocalPlaylist, action: LocalPlaylistListActionType) => void;");
    expect(listSource).toContain("onAction(playlist, action.type)");
  });
});
