import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { AudioLines, Play, Square } from "lucide-react-native";
import type { SongComment } from "@/services/musicApi";
import type { CommentVoiceItem, CommentVoiceState } from "@/services/commentVoiceController";
import type { ThemePalette } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

interface Props {
  itemId: string;
  data: Pick<SongComment, "content" | "voice" | "voiceError">;
  palette: ThemePalette;
  playback: CommentVoiceState;
  onToggle: (item: CommentVoiceItem) => void;
  compact?: boolean;
}

export function CommentVoiceContent({ itemId, data, palette, playback, onToggle, compact }: Props) {
  const current = playback.item?.id === itemId;
  const busy = current && ["preparing", "loading", "stopping"].includes(playback.phase);
  const playing = current && playback.phase === "playing";
  const error = data.voiceError || (current ? playback.error : null);
  const { voice } = data;
  return (
    <View style={styles.root}>
      {data.content ? (
        <Text style={[styles.content, { color: compact ? palette.textMuted : palette.text }]} numberOfLines={compact ? 2 : undefined}>
          {data.content}
        </Text>
      ) : null}
      {voice ? (
        <Pressable
          onPress={() => onToggle({ id: itemId, voice })}
          accessibilityRole="button"
          accessibilityLabel={`${playing || busy ? "停止语音" : "播放语音"}，${Math.ceil(voice.duration)}秒`}
          accessibilityState={{ busy }}
          style={({ pressed }) => [styles.voice, { backgroundColor: palette.surfaceMuted }, pressed && styles.pressed]}
        >
          {busy ? <ActivityIndicator size="small" color={palette.primary} /> : playing ? <Square size={18} color={palette.primary} /> : <Play size={18} color={palette.primary} />}
          <AudioLines size={24} color={palette.primary} />
          <Text style={[styles.duration, { color: palette.text }]}>{Math.ceil(voice.duration)} 秒</Text>
          {busy ? <Text style={[styles.status, { color: palette.textMuted }]}>{playback.phase === "stopping" ? "停止中" : "加载中"}</Text> : null}
        </Pressable>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{error}{voice ? "，点击语音条重试" : ""}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: spacing.xs, gap: spacing.xxs },
  content: { fontSize: typography.body, lineHeight: 20 },
  voice: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs, minHeight: touch.minTarget, paddingHorizontal: spacing.s, paddingVertical: spacing.xs, borderRadius: radius.md },
  duration: { fontSize: typography.body, fontWeight: "600" },
  status: { fontSize: typography.caption },
  error: { fontSize: typography.caption, lineHeight: 18 },
  pressed: { opacity: 0.7 },
});
