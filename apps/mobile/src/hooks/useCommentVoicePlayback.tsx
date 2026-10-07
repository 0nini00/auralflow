import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import Video, { type VideoRef } from "react-native-video";
import { createCommentVoiceController, type CommentVoiceState } from "@/services/commentVoiceController";
import { createMediaAudioSession } from "@/services/mediaAudioSession";
import { logger } from "@/services/logger";

export function useCommentVoicePlayback(visible: boolean, songId: string | undefined) {
  const videoRef = useRef<VideoRef | null>(null);
  const [playback, setPlayback] = useState<CommentVoiceState>({ item: null, token: 0, phase: "idle", error: null });
  const [controller] = useState(() => createCommentVoiceController({
    createSession: createMediaAudioSession,
    // 原生确认 abandonAudioFocus 和 releasePlayer 已完成，才能恢复歌曲。
    stopMedia: async () => { await videoRef.current?.release(); },
    onChange: setPlayback,
    onError: (error) => logger.warn("评论语音失败", error),
  }));
  const url = playback.item?.voice.url;
  const source = useMemo(() => url ? { uri: url, headers: { Referer: "https://music.163.com/" }, minLoadRetryCount: 0 } : undefined, [url]);

  useEffect(() => {
    // 资源切换、隐藏或卸载不接管新的播放意图；用户点关闭按钮走显式 stop(true)。
    if (!visible || !songId) void controller.stop(false);
    return () => { void controller.stop(false); };
  }, [controller, visible, songId]);

  const { token, phase } = playback;
  const player = source && ["loading", "playing", "stopping"].includes(phase) ? (
    <Video
      key={token}
      ref={videoRef}
      source={source}
      style={styles.player}
      paused={!visible || phase === "stopping"}
      controls={false}
      repeat={false}
      playInBackground={false}
      playWhenInactive={false}
      enterPictureInPictureOnLeave={false}
      preventsDisplaySleepDuringVideoPlayback={false}
      onLoad={() => controller.loaded(token)}
      onBuffer={({ isBuffering }) => controller.buffering(token, isBuffering)}
      onEnd={() => { void controller.ended(token); }}
      onError={(event) => {
        logger.warn("评论语音原生播放错误", event.error);
        void controller.failed(token, new Error("语音播放失败"));
      }}
      onAudioFocusChanged={({ hasAudioFocus }) => { if (!hasAudioFocus) void controller.interrupted(token); }}
      onAudioBecomingNoisy={() => { void controller.interrupted(token); }}
    />
  ) : null;
  return { playback, controller, player };
}

const styles = StyleSheet.create({
  // 只承载音频解码，不参与评论排版，也不创建系统媒体通知。
  player: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
