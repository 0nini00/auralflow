import { useEffect, useRef } from "react";

import { checkBackgroundPlaybackReadiness } from "@/services/backgroundPlaybackService";
import { usePlayerStore } from "@/stores/playerStore";

/**
 * 后台播放权限守卫（渲染 null，只做副作用）。
 *
 * 在「本次运行第一次真正出声」时检查后台运行权限：未加入电池优化白名单时引导用户授权。
 * 放在用户开始播放之后而非冷启动时，是因为此刻「后台播放」的诉求最明确，用户更容易理解授权原因；
 * 冷启动就弹窗则像是无关打扰，容易被随手拒绝。
 *
 * 独立成组件而不写在 AppShell 里：避免把 isPlaying 订阅挂到包裹整个导航树的组件上，
 * 让播放/暂停只触发这一个空组件重渲染。
 */
export function BackgroundPlaybackGuard() {
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!isPlaying || checkedRef.current) return;
    checkedRef.current = true;
    void checkBackgroundPlaybackReadiness();
  }, [isPlaying]);

  return null;
}
