import { getWyCookie } from "./wyAccountService";
import { postWyWeapi } from "./wyPlaylistService";

export interface ScrobbleParams {
  songId: string;
  sourceId?: string;
  durationSeconds: number;
}

/**
 * 网易云听歌打点（scrobble）：
 * 向网易云上报真实播放时长，用于生成年度歌单、个性化推荐和云村听歌排行。
 * 对齐 LX-N 的 weapi/feedback/weblog 实现。
 * 若未登录或上报失败，仅打印 warning，绝不抛错，保证不影响正常的本地历史记录。
 */
export async function scrobbleWySong(params: ScrobbleParams): Promise<boolean> {
  const { songId, sourceId = "0", durationSeconds } = params;
  if (!songId) return false;

  try {
    const cookie = await getWyCookie();
    if (!cookie) return false;

    const payload = {
      logs: JSON.stringify([
        {
          action: "play",
          json: {
            id: songId,
            download: 0,
            type: "song",
            sourceId: String(sourceId || "0"),
            time: Math.max(1, Math.floor(durationSeconds)),
            end: "playend",
            wifi: 0,
          },
        },
      ]),
    };

    const res = await postWyWeapi<{ code?: number }>("/feedback/weblog", payload, cookie);
    return res?.code === 200;
  } catch (error) {
    // 静默降级：打点网络错误不向用户弹窗，不阻断正常播放流程
    console.warn("网易云听歌打点失败 (静默忽略):", error instanceof Error ? error.message : String(error));
    return false;
  }
}
