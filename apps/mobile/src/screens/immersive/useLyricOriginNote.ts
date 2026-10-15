import { useEffect, useState } from "react";
import type { LyricOriginNote } from "@/services/localMediaPlaybackModel";

/**
 * 来源标注「出现一次就消失」：内容变化（换歌、重新匹配到来源）或歌词页重新打开时重新计时，
 * 到点自行退场。常驻的标注会一直压在歌词上——它只需要在歌词刚出现的那一刻被看见一次。
 *
 * 传 `active`（歌词页是否可见）而不是让调用方自己去管定时器：页面不可见时挂一个待触发的
 * 隐藏计时没有意义，还会在页面被复用（同一屏切歌）时留下半死的状态。
 */
export function useLyricOriginNote(
  note: LyricOriginNote | undefined,
  active: boolean,
): LyricOriginNote | undefined {
  const [shown, setShown] = useState<LyricOriginNote | undefined>(undefined);
  const text = note?.text ?? "";
  const holdMs = note?.holdMs ?? 0;

  useEffect(() => {
    if (!active || !text) {
      setShown(undefined);
      return;
    }
    setShown({ text, holdMs });
    const timer = setTimeout(() => setShown(undefined), holdMs);
    return () => clearTimeout(timer);
  }, [text, holdMs, active]);

  return shown;
}
