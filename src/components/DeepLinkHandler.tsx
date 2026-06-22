import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";

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
      } catch (err) {
        console.warn("[deep-link] 解析失败", err);
      }
    };

    onOpenUrl((urls) => handleUrl(urls))
      .then((fn) => { unlisten = fn; })
      .catch((err) => console.warn("[deep-link] 监听注册失败", err));

    return () => {
      active = false;
      unlisten?.();
    };
  }, [navigate]);

  return null;
}
