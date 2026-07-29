import { useEffect } from "react";
import { usePlayerStore } from "@/stores/playerStore";

/** 焦点在可编辑区域时不抢快捷键（输入框 / 下拉 / contentEditable） */
function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true;
  }
  if (target instanceof HTMLSelectElement) return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableKeyboardTarget(e.target)) return;
      // 带 Ctrl/Meta/Alt 的组合键交给系统或其它绑定
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // 每次按键都读最新 store，避免闭包里的 progress/volume 过期
      const {
        togglePlay,
        next,
        prev,
        setVolume,
        volume,
        setProgress,
        progress,
        duration,
        toggleMute,
      } = usePlayerStore.getState();

      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) {
            void prev();
          } else {
            setProgress(Math.max(0, progress - 5));
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            void next();
          } else {
            const max = Number.isFinite(duration) && duration > 0 ? duration : progress + 5;
            setProgress(Math.min(max, progress + 5));
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          // store.volume 在静音期间仍是逻辑音量；setVolume 非 0 会自动解除静音
          setVolume(Math.min(1, volume + 0.1));
          break;

        case "ArrowDown":
          e.preventDefault();
          setVolume(Math.max(0, volume - 0.1));
          break;

        case "m":
        case "M":
          e.preventDefault();
          toggleMute();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
