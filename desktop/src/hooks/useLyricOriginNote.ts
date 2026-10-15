import { useEffect, useState } from "react";
import type { LyricOriginNote } from "@/services/lyrics/lyricOriginNote";

/**
 * 来源标注「出现一次就消失」：到点自行退场。
 *
 * 重新出现的时机有两个：标注内容变化（换到另一首需要提示的歌）、或 `resetKey` 变化
 * （调用方传当前曲标识，这样同一首歌被复用同一段标注文本时也会为新歌再提示一次）。
 * 卸载或这两个键变化时清掉计时器，避免在旧状态上留下一次迟到的隐藏。
 */
export function useLyricOriginNote(
  note: LyricOriginNote | undefined,
  resetKey?: string,
): LyricOriginNote | undefined {
  const [shown, setShown] = useState<LyricOriginNote | undefined>(undefined);
  const text = note?.text ?? "";
  const holdMs = note?.holdMs ?? 0;

  useEffect(() => {
    if (!text) {
      setShown(undefined);
      return;
    }
    setShown({ text, holdMs });
    const timer = setTimeout(() => setShown(undefined), holdMs);
    return () => clearTimeout(timer);
  }, [text, holdMs, resetKey]);

  return shown;
}
