import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import type { MusicInfo } from "@lx/core";
import { usePlaylistStore, type Playlist } from "@/stores/playlistStore";

interface ExportEnvelope {
  app: "auralflow";
  version: 1;
  exportedAt: number;
  playlists: Array<{
    name: string;
    description?: string;
    songs: MusicInfo[];
  }>;
}

/** 导出指定歌单到 JSON 文件。返回保存路径，取消则返回 null。 */
export async function exportPlaylists(playlists: Playlist[]): Promise<string | null> {
  if (playlists.length === 0) return null;

  const defaultName =
    playlists.length === 1 ? `${playlists[0].name}.json` : "auralflow-playlists.json";

  const target = await save({
    defaultPath: defaultName,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!target) return null;

  const envelope: ExportEnvelope = {
    app: "auralflow",
    version: 1,
    exportedAt: Date.now(),
    playlists: playlists.map((p) => ({
      name: p.name,
      description: p.description,
      songs: p.songs,
    })),
  };

  await writeTextFile(target, JSON.stringify(envelope, null, 2));
  return target;
}

/** 从 JSON 文件导入歌单。返回导入的歌单数量；取消返回 0。 */
export async function importPlaylists(): Promise<number> {
  const picked = await open({
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  const filePath = typeof picked === "string" ? picked : null;
  if (!filePath) return 0;

  const raw = await readTextFile(filePath);
  const data = JSON.parse(raw) as Partial<ExportEnvelope>;
  const list = Array.isArray(data?.playlists) ? data!.playlists : [];
  if (list.length === 0) return 0;

  const store = usePlaylistStore.getState();
  let count = 0;
  for (const p of list) {
    if (!p?.name) continue;
    store.importPlaylist(p.name, p.description, (p.songs ?? []) as MusicInfo[]);
    count++;
  }
  return count;
}
