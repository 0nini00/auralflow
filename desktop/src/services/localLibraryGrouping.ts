import type { LocalSong } from './localMusicService';

export type LocalLibraryCategory = 'all' | 'artist' | 'album' | 'folder';
export type LocalLibraryGroupCategory = Exclude<LocalLibraryCategory, 'all'>;
export interface LocalLibraryGroup {
  id: string;
  title: string;
  subtitle: string;
  songs: LocalSong[];
}

const cleanLabel = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ');
const labelKey = (value: string) => cleanLabel(value).toLowerCase();

export function splitLocalArtists(artist: string): string[] {
  // 只认明确分隔符；裸斜线、逗号和 & 可能属于 AC/DC 等完整名称。
  const names = artist.split(/[;；、]|\s+\/\s+/).map(cleanLabel).filter(Boolean);
  const uniqueNames = new Map<string, string>();
  for (const name of names) {
    if (!uniqueNames.has(labelKey(name))) uniqueNames.set(labelKey(name), name);
  }
  return uniqueNames.size ? [...uniqueNames.values()] : ['未知艺术家'];
}

export function normalizeLibraryPath(path: string): string {
  let normalized = path.trim().replace(/\\/g, '/');
  normalized = normalized.replace(/^\/\/\?\/UNC\//i, '//').replace(/^\/\/\?\//, '');
  const isUnc = normalized.startsWith('//');
  const isWindows = isUnc || /^[a-z]:\//i.test(normalized);
  normalized = normalized.replace(/\/+/g, '/');
  if (isUnc) normalized = `/${normalized}`;
  if (!/^(?:[a-z]:)?\/$/i.test(normalized)) normalized = normalized.replace(/\/$/, '');
  return isWindows ? normalized.toLowerCase() : normalized;
}

function folderDescriptor(path: string) {
  const normalized = normalizeLibraryPath(path);
  const separator = normalized.lastIndexOf('/');
  if (separator < 0) return { id: 'folder:unknown', title: '未知文件夹', subtitle: '' };
  const folder = separator === 0 || /^[a-z]:\//i.test(normalized) && separator === 2
    ? normalized.slice(0, separator + 1)
    : normalized.slice(0, separator);
  return { id: `folder:${folder}`, title: folder.split('/').pop() || folder, subtitle: folder };
}

function descriptors(song: LocalSong, category: LocalLibraryGroupCategory) {
  if (category === 'folder') return [folderDescriptor(song.path)];
  if (category === 'artist') {
    return splitLocalArtists(song.artist).map((artist) => ({
      id: `artist:${labelKey(artist)}`, title: artist, subtitle: '',
    }));
  }
  const artist = cleanLabel(song.artist) || '未知艺术家';
  const album = cleanLabel(song.album) || '未知专辑';
  return [{ id: `album:${JSON.stringify([labelKey(artist), labelKey(album)])}`, title: album, subtitle: artist }];
}

/** 分组仅持有原曲引用；元数据及新增覆盖字段都由 localSongs 这一数据源提供。 */
export function groupLocalSongs(songs: readonly LocalSong[], category: LocalLibraryGroupCategory): LocalLibraryGroup[] {
  const groups = new Map<string, LocalLibraryGroup>();
  for (const song of songs) {
    for (const descriptor of descriptors(song, category)) {
      const group = groups.get(descriptor.id);
      if (group) group.songs.push(song);
      else groups.set(descriptor.id, { ...descriptor, songs: [song] });
    }
  }
  return [...groups.values()].sort((a, b) =>
    a.title.localeCompare(b.title, 'zh-CN', { numeric: true }) || a.subtitle.localeCompare(b.subtitle, 'zh-CN'));
}

export function filterLocalSongs(songs: readonly LocalSong[], query: string): LocalSong[] {
  const terms = labelKey(query).replace(/\\/g, '/').split(/\s+/).filter(Boolean);
  return songs.filter((song) => {
    const content = labelKey([song.title, cleanLabel(song.artist) || '未知艺术家', cleanLabel(song.album) || '未知专辑', normalizeLibraryPath(song.path)].join(' '));
    return terms.every((term) => content.includes(term));
  });
}
