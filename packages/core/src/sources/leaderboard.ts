/**
 * 网易云「排行榜 / 歌单广场」的共享口径与纯映射。
 *
 * 为什么放在 core：移动端早就有一份内置榜单清单（对齐 lx 的 leaderboard.js），
 * 现在桌面端也要做同样的两个页面。榜单 id 是硬编码的号令——各写一份，一边加榜、
 * 另一边没加，用户就会问「为什么手机有桌面没有」；分类口径同理，一边叫「ACG」
 * 一边叫「动漫」，同一个筛选条件就会给出不同结果。按仓库既定原则（两端必须给出
 * 相同答案的规则收敛进 core），清单与归一化都放这里。
 *
 * 两条来自实测的约束，改这里之前先读：
 *
 * 1. 榜单就是歌单。`/api/toplist` 返回的每一项 `id` 可以直接当歌单 id 用，
 *    详情走 `/v3/playlist/detail`，不需要额外的「榜单详情」接口。
 * 2. 榜单清单必须先内置、再用接口补充。`/api/toplist` 会随版本增删榜单，也会
 *    因为网络抖动整段失败；只认接口的话，排行榜页会在弱网下直接空白。内置清单
 *    保证「至少能进、能点」，接口只负责补封面、更新频率和 TOP3 试读。
 */

export type WyBoardGroupKey = "official" | "language" | "genre" | "scene";

/** 内置清单里的一条榜单引用；id 即网易云歌单 id。 */
export interface WyBoardRef {
  id: string;
  name: string;
}

export interface WyBoardGroup {
  key: WyBoardGroupKey;
  title: string;
  boards: readonly WyBoardRef[];
}

/**
 * 排行榜页展示用的一条榜单。
 *
 * `coverUrl` / `updateFrequency` / `topSongs` 都来自 `/api/toplist`，缺失是常态
 * （接口失败、新榜还没进返回体），页面必须能只用 id + name 也站得住。
 */
export interface WyLeaderboardBoard {
  id: string;
  name: string;
  group: WyBoardGroupKey;
  coverUrl?: string;
  updateFrequency?: string;
  /** 榜单前三首试读，来自 toplist 的 `tracks[].first/second`。 */
  topSongs?: { title: string; artist: string }[];
}

/** 内置榜单分组（对齐 lx `leaderboard.js` 的 bangid）。顺序即页面展示顺序。 */
export const WY_BOARD_GROUPS: readonly WyBoardGroup[] = [
  {
    key: "official",
    title: "官方榜",
    boards: [
      { id: "19723756", name: "飙升榜" },
      { id: "3779629", name: "新歌榜" },
      { id: "2884035", name: "原创榜" },
      { id: "3778678", name: "热歌榜" },
    ],
  },
  {
    key: "language",
    title: "语种榜",
    boards: [
      { id: "5059644681", name: "日语榜" },
      { id: "745956260", name: "韩语榜" },
      { id: "5059642708", name: "国风榜" },
      { id: "6732051320", name: "俄语榜" },
      { id: "7095271308", name: "泰语榜" },
      { id: "6732014811", name: "越南语榜" },
      { id: "60198", name: "美国 Billboard 榜" },
      { id: "180106", name: "UK 排行榜" },
      { id: "60131", name: "日本 Oricon 榜" },
      { id: "27135204", name: "法国 NRJ 周榜" },
    ],
  },
  {
    key: "genre",
    title: "流派榜",
    boards: [
      { id: "991319590", name: "说唱榜" },
      { id: "71384707", name: "古典榜" },
      { id: "1978921795", name: "电音榜" },
      { id: "71385702", name: "ACG 榜" },
      { id: "5059633707", name: "摇滚榜" },
      { id: "5059661515", name: "民谣榜" },
      { id: "10520166", name: "国电榜" },
      { id: "21845217", name: "KTV 唛榜" },
    ],
  },
  {
    key: "scene",
    title: "场景榜",
    boards: [
      { id: "6723173524", name: "网络热歌榜" },
      { id: "5338990334", name: "潜力爆款榜" },
      { id: "6688069460", name: "听歌识曲榜" },
      { id: "5453912201", name: "黑胶 VIP 爱听榜" },
      { id: "7785123708", name: "黑胶 VIP 新歌榜" },
      { id: "7785066739", name: "黑胶 VIP 热歌榜" },
    ],
  },
];

/**
 * 歌单广场分类。网易云 `/api/playlist/catlist` 已下线（404），只能内置；
 * 这份清单与 lx 桌面端「推荐歌单」的分类口径一致，两端不要各自增删。
 */
export const WY_PLAYLIST_CATEGORIES = [
  "全部",
  "华语",
  "欧美",
  "日语",
  "韩语",
  "粤语",
  "摇滚",
  "民谣",
  "电子",
  "影视",
  "说唱",
  "国风",
  "轻音乐",
  "ACG",
  "怀旧",
  "网络歌曲",
] as const;

export type WyPlaylistCategory = (typeof WY_PLAYLIST_CATEGORIES)[number];

/** 歌单广场排序：热门稳定、最新会变，刷新才看得出区别。 */
export type WyPlaylistOrder = "hot" | "new";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mapTopSongs(value: unknown): { title: string; artist: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const songs = value
    .map((item) => {
      const record = asRecord(item);
      return {
        title: readString(record?.first) ?? "",
        artist: readString(record?.second) ?? "",
      };
    })
    // 只有曲名的试读才有意义：`first` 为空说明这一行是脏数据。
    .filter((song) => song.title.length > 0);
  return songs.length > 0 ? songs : undefined;
}

/**
 * 内置清单 + `/api/toplist` 元数据 → 页面用的榜单列表。
 *
 * 传入非数组（请求失败、字段缺失）时退化为「只有 id + name」的内置清单：
 * 封面用占位色块，TOP3 试读整块不渲染。这是排行榜页能离线进的前提。
 */
export function mapLeaderboardBoards(remoteList: unknown): WyLeaderboardBoard[] {
  const remoteById = new Map<string, Record<string, unknown>>();
  if (Array.isArray(remoteList)) {
    for (const item of remoteList) {
      const record = asRecord(item);
      if (record && record.id != null) remoteById.set(String(record.id), record);
    }
  }

  return WY_BOARD_GROUPS.flatMap((group) =>
    group.boards.map((board) => {
      const meta = remoteById.get(board.id);
      return {
        id: board.id,
        name: board.name,
        group: group.key,
        // 实测 coverImgUrl 在列表项上，picUrl 是部分接口的别名。
        coverUrl: readString(meta?.coverImgUrl) ?? readString(meta?.picUrl),
        updateFrequency: readString(meta?.updateFrequency),
        topSongs: mapTopSongs(meta?.tracks),
      };
    }),
  );
}

export interface WyBoardGroupSection {
  key: WyBoardGroupKey;
  title: string;
  boards: WyLeaderboardBoard[];
}

/**
 * 按内置分组切开，供页面分区渲染。
 *
 * 只遍历内置分组：榜单来源本就是这份清单，多出来的 group 键只可能来自
 * 上游数据漂移，宁可不显示，也不要凭空长出一个「其他」分区。
 */
export function groupLeaderboards(
  boards: readonly WyLeaderboardBoard[],
): WyBoardGroupSection[] {
  return WY_BOARD_GROUPS.map((group) => ({
    key: group.key,
    title: group.title,
    boards: boards.filter((board) => board.group === group.key),
  })).filter((section) => section.boards.length > 0);
}

/**
 * 播放量角标：`12万` / `1.5亿`。
 *
 * 只在有正数时返回文本——`0` 和缺失一律返回 null，由调用方决定不渲染角标，
 * 免得卡片上出现「0 播放」这种比没有更糟的信息。
 */
export function formatPlayCount(count?: number | null): string | null {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return null;
  if (count >= 100_000_000) return `${(count / 100_000_000).toFixed(1)}亿`;
  if (count >= 10_000) return `${Math.round(count / 10_000)}万`;
  return String(Math.round(count));
}
