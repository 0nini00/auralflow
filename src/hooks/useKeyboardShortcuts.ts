import { useEffect } from "react";
import { usePlayerStore } from "@/stores/playerStore";

export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const {
        togglePlay,
        next,
        prev,
        setVolume,
        volume,
        setProgress,
        progress,
        duration,
      } = usePlayerStore.getState();

      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) {
            // Shift + Left: Previous track
            void prev();
          } else {
            // Left: Rewind 5 seconds
            setProgress(Math.max(0, progress - 5));
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            // Shift + Right: Next track
            void next();
          } else {
            // Right: Forward 5 seconds
            setProgress(Math.min(duration, progress + 5));
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          // Up: Volume up
          setVolume(Math.min(1, volume + 0.1));
          break;

        case "ArrowDown":
          e.preventDefault();
          // Down: Volume down
          setVolume(Math.max(0, volume - 0.1));
          break;

        case "m":
        case "M":
          e.preventDefault();
          usePlayerStore.getState().toggleMute();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
