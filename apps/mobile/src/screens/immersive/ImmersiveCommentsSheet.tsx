import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
} from "react-native";
import { Heart, MessageCircle, Send, X } from "lucide-react-native";
import type { MusicInfo } from "@lx/core";
import type { ThemePalette } from "@/stores/themeStore";
import { fetchNeteaseComments, type SongComment } from "@/services/musicApi";
import { sendWyComment } from "@/services/wyPlaylistService";
import { useAccountStore } from "@/stores/accountStore";

export interface ImmersiveCommentsSheetProps {
  visible: boolean;
  onClose: () => void;
  song?: MusicInfo | null;
  palette: ThemePalette;
}

const PAGE_SIZE = 20;

function formatCommentTime(createdAt: number): string {
  if (!createdAt || createdAt <= 0) return "";
  const diffSec = Math.floor((Date.now() - createdAt) / 1000);
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}天前`;
  return new Date(createdAt).toLocaleDateString("zh-CN");
}

function CommentRow({ comment, palette }: { comment: SongComment; palette: ThemePalette }) {
  return (
    <View style={styles.row}>
      {comment.avatarUrl ? (
        <Image source={{ uri: comment.avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: palette.surfaceStrong }]}>
          <Text style={[styles.avatarFallbackText, { color: palette.textMuted }]}>
            {(comment.nickname || "?")[0]}
          </Text>
        </View>
      )}
      <View style={styles.rowBody}>
        <View style={styles.rowHeader}>
          <Text style={[styles.nickname, { color: palette.text }]} numberOfLines={1}>
            {comment.nickname}
          </Text>
          <View style={styles.likeWrap}>
            <Heart size={12} color={palette.textMuted} />
            {comment.likedCount > 0 ? (
              <Text style={[styles.likeCount, { color: palette.textMuted }]}>
                {comment.likedCount}
              </Text>
            ) : null}
          </View>
        </View>
        {comment.beReplied && comment.beReplied.length > 0 ? (
          <Text style={[styles.replied, { color: palette.textMuted }]} numberOfLines={2}>
            回复 {comment.beReplied[0].nickname}: {comment.beReplied[0].content}
          </Text>
        ) : null}
        <Text style={[styles.content, { color: palette.text }]}>{comment.content}</Text>
        <Text style={[styles.time, { color: palette.textMuted }]}>
          {formatCommentTime(comment.createdAt)}
        </Text>
      </View>
    </View>
  );
}

/** 沉浸式播放器「评论」面板：对齐 lx 评论（网易云数据源） */
export function ImmersiveCommentsSheet({
  visible,
  onClose,
  song,
  palette,
}: ImmersiveCommentsSheetProps) {
  // 仅网易云（wy）曲目有真实评论 ID：wy 的 song.id 即网易云歌曲 ID
  // （gateway.trackId 是播放 url_id，可能非歌曲 ID，不作评论资源用）。
  const songId = song?.source === "wy" ? song.id : undefined;
  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);

  const [items, setItems] = useState<SongComment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const requestSequenceRef = useRef(0);
  const currentSongIdRef = useRef(songId);
  const visibleRef = useRef(visible);

  currentSongIdRef.current = songId;
  visibleRef.current = visible;

  const load = async (offset: number, append: boolean) => {
    const requestedSongId = songId;
    if (!requestedSongId) return;

    const requestToken = ++requestSequenceRef.current;
    const isCurrentRequest = () =>
      requestToken === requestSequenceRef.current &&
      currentSongIdRef.current === requestedSongId &&
      visibleRef.current;

    if (!isCurrentRequest()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchNeteaseComments(requestedSongId, offset, PAGE_SIZE);
      if (!isCurrentRequest()) return;
      setTotal(result.total);
      setItems((prev) => (append ? [...prev, ...result.comments] : result.comments));
    } catch (e) {
      if (!isCurrentRequest()) return;
      setError(e instanceof Error ? e.message : String(e));
      if (!append) setItems([]);
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  };

  // 打开或歌曲切换时重置并拉取第一页
  useEffect(() => {
    requestSequenceRef.current += 1;
    if (!visible || !songId) {
      setItems([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    } else {
      void load(0, false);
    }

    return () => {
      requestSequenceRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, songId]);

  const handleLoadMore = () => {
    if (loading || loadingMore || items.length >= total) return;
    setLoadingMore(true);
    void load(items.length, true);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    void load(0, false);
  };

  const handleSendComment = async () => {
    const content = inputText.trim();
    if (!content || !songId || sending) return;
    if (!isLoggedIn) {
      Alert.alert("未登录", "请在 设置 → 账号与服务 登录网易云账号后再评论");
      return;
    }
    const submittedSongId = songId;
    setSending(true);
    try {
      await sendWyComment(submittedSongId, content, 1);
      if (currentSongIdRef.current !== submittedSongId || !visibleRef.current) return;
      setInputText("");
      // 发送成功后将新评论置顶（本地乐观展示），随后刷新真实列表。
      const optimistic: SongComment = {
        id: `local-${Date.now()}`,
        content,
        userId: "",
        nickname: "我",
        likedCount: 0,
        createdAt: Date.now(),
      };
      setTotal((prev) => prev + 1);
      setItems((prev) => [optimistic, ...prev]);
      void load(0, false);
    } catch (e) {
      Alert.alert("评论失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: palette.surface }]}>
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <MessageCircle size={18} color={palette.primary} />
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                {song?.name ?? "评论"}
              </Text>
              {total > 0 ? (
                <Text style={[styles.count, { color: palette.textMuted }]}>({total})</Text>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="关闭评论">
              <X size={20} color={palette.textMuted} />
            </Pressable>
          </View>

          {loading && items.length === 0 ? (
            <View style={styles.center}>
              <ActivityIndicator color={palette.primary} />
            </View>
          ) : error ? (
            <View style={styles.center}>
              <MessageCircle size={36} color={palette.textMuted} />
              <Text style={[styles.emptyText, { color: palette.textMuted }]}>评论加载失败</Text>
              <Text style={[styles.errorText, { color: palette.textMuted }]}>{error}</Text>
              <Pressable
                onPress={() => void load(0, false)}
                style={[styles.retryButton, { borderColor: palette.border }]}
              >
                <Text style={[styles.retryText, { color: palette.primary }]}>重试</Text>
              </Pressable>
            </View>
          ) : items.length === 0 ? (
            <View style={styles.center}>
              <MessageCircle size={36} color={palette.textMuted} />
              <Text style={[styles.emptyText, { color: palette.textMuted }]}>还没有评论</Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item, index) => `${item.id}-${index}`}
              renderItem={({ item }) => <CommentRow comment={item} palette={palette} />}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.3}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              ListFooterComponent={
                loadingMore ? (
                  <ActivityIndicator color={palette.primary} style={styles.footer} />
                ) : null
              }
              ListEmptyComponent={null}
              contentContainerStyle={styles.listContent}
              style={styles.list}
            />
          )}

          {/* 评论输入栏：仅网易云曲目且已登录时展示 */}
          {songId ? (
            <View style={[styles.inputBar, { borderTopColor: palette.border, backgroundColor: palette.surface }]}>
              <TextInput
                style={[styles.input, { backgroundColor: palette.surfaceMuted, color: palette.text }]}
                value={inputText}
                onChangeText={setInputText}
                placeholder={isLoggedIn ? "说点什么…" : "登录后可评论"}
                placeholderTextColor={palette.textSubtle}
                multiline
                maxLength={500}
                editable={isLoggedIn}
                onSubmitEditing={() => void handleSendComment()}
              />
              <Pressable
                onPress={() => void handleSendComment()}
                disabled={!isLoggedIn || sending || !inputText.trim()}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="发送评论"
              >
                {sending ? (
                  <ActivityIndicator color={palette.primary} size="small" />
                ) : (
                  <Send size={20} color={isLoggedIn && inputText.trim() ? palette.primary : palette.textSubtle} />
                )}
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    maxHeight: "78%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingBottom: 24,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerTitleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    flexShrink: 1,
  },
  count: {
    fontSize: 14,
  },
  list: {
    paddingHorizontal: 16,
  },
  listContent: {
    paddingBottom: 8,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    fontSize: 18,
    fontWeight: "600",
  },
  rowBody: {
    flex: 1,
    marginLeft: 12,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  nickname: {
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
  },
  likeWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: 8,
  },
  likeCount: {
    fontSize: 12,
  },
  replied: {
    fontSize: 13,
    marginTop: 6,
  },
  content: {
    fontSize: 15,
    lineHeight: 20,
    marginTop: 6,
  },
  time: {
    fontSize: 12,
    marginTop: 6,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 14,
    marginTop: 12,
  },
  errorText: {
    fontSize: 12,
    marginTop: 4,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  retryText: {
    fontSize: 14,
    fontWeight: "600",
  },
  footer: {
    paddingVertical: 16,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 14,
  },
});