import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

/**
 * 处理 auralflow:// 深链。
 * 支持：playlist/<id>、album/<id>、artist/<id>、search/<kw>、fm、daily
 */
export function DeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;

    const handleUrl = (urls: string[]) => {
      if (!active) return;
      const raw = urls?.[0];
      if (!raw) return;
      try {
        const url = new URL(raw);
        if (url.protocol !== "auralflow:") return;
        const path = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
        const route = url.hostname || path[0] || "";
        // auralflow://playlist/123 → hostname=playlist, path=["123"]，arg 取 path[0]
        const arg = path[0] ?? "";

        switch (route) {
          case "playlist":
            if (arg) navigate(`/playlist/${arg}`);
            break;
          case "album":
            if (arg) navigate(`/album/${arg}`);
            break;
          case "artist":
            if (arg) navigate(`/artist/${arg}`);
            break;
          case "search":
            navigate(`/search?q=${encodeURIComponent(decodeURIComponent(arg))}`);
            break;
          case "fm":
            navigate("/fm");
            break;
          case "daily":
            navigate("/daily");
            break;
          default:
            break;
        }
      } catch (error) {
        // 深链可能来自任意来源（浏览器、文件管理器、剪贴板），畸形 URL 是常态。
        // 不能静默：用户点了链接却没反应时，只有日志能说明是哪一段坏了。
        console.warn(`[deep-link] 无法解析深链：${raw}`, error);
      }
    };

    // 冷启动（应用被深链拉起）：插件的 CLI 转发发生在前端挂载之前，
    // onOpenUrl 收不到那一次，必须主动 getCurrent() 取回启动 URL。
    getCurrent()
      .then((urls) => { if (urls?.length) handleUrl(urls); })
      .catch(() => undefined);

    onOpenUrl((urls) => handleUrl(urls))
      .then((fn) => { unlisten = fn; })
      .catch(() => undefined);

    return () => {
      active = false;
      unlisten?.();
    };
  }, [navigate]);

  return null;
}
