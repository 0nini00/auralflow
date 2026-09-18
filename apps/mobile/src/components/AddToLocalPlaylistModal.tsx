import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, Cloud, FolderHeart, ListMusic, Plus, X } from "lucide-react-native";
import type { MusicInfo } from "@lx/core";

import { CachedImage } from "@/components/CachedImage";
import { resolveLocalPlaylistCover } from "@/services/localPlaylistModel";
import {
  buildOwnedWyPlaylistSongOptions,
  buildLocalPlaylistSongOptions,
  getAddToWyPlaylistEmptyText,
  getAddToLocalPlaylistEmptyText,
} from "@/services/localPlaylistSelectionModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import { radius, spacing, typography } from "@/theme/tokens";
import { Touchable } from "@/components/Touchable";
import { withAlpha } from "@/services/themePaletteModel";
import { hapticLight } from "@/services/hapticService";

interface AddToLocalPlaylistModalProps {
  visible: boolean;
  song?: MusicInfo;
  songs?: MusicInfo[];
  onClose: () => void;
}

export function AddToLocalPlaylistModal({
  visible,
  song,
  songs,
  onClose,
}: AddToLocalPlaylistModalProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const playlists = usePlaylistStore((state) => state.playlists);
  const localPlaylists = usePlaylistStore((state) => state.localPlaylists);
  const addSongsToLocalPlaylist = usePlaylistStore((state) => state.addSongsToLocalPlaylist);
  const addSongToWyPlaylist = usePlaylistStore((state) => state.addSongToWyPlaylist);
  const createLocalPlaylistWithSongs = usePlaylistStore((state) => state.createLocalPlaylistWithSongs);

  const targetSongs = useMemo(() => songs ?? (song ? [song] : []), [song, songs]);
  const primarySong = targetSongs[0];

  const [addingPlaylistId, setAddingPlaylistId] = useState<string | null>(null);
  const [addingWyPlaylistId, setAddingWyPlaylistId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreateInput, setShowCreateInput] = useState(false);

  const options = useMemo(() => {
    if (!primarySong) return [];
    if (targetSongs.length === 1) return buildLocalPlaylistSongOptions(localPlaylists, primarySong);
    const targetKeys = new Set(targetSongs.map(getSongKey));
    return localPlaylists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      cover: resolveLocalPlaylistCover(playlist),
      trackCount: playlist.songs.length,
      containsSong: playlist.songs.filter((item) => targetKeys.has(getSongKey(item))).length === targetKeys.size,
    }));
  }, [localPlaylists, primarySong, targetSongs]);

  const emptyText = targetSongs.length === 0 ? "没有可添加的歌曲" : getAddToLocalPlaylistEmptyText(options);
  const wyOptions = useMemo(
    () => (targetSongs.length === 1 && primarySong ? buildOwnedWyPlaylistSongOptions(playlists, primarySong) : []),
    [playlists, primarySong, targetSongs.length],
  );
  const wyEmptyText = targetSongs.length > 1
    ? "批量收藏仅支持本地歌单"
    : primarySong
    ? getAddToWyPlaylistEmptyText(wyOptions, primarySong)
    : "没有可添加的歌曲";

  const handleAdd = async (playlistId: string) => {
    if (addingPlaylistId || addingWyPlaylistId) return;
    setAddingPlaylistId(playlistId);
    hapticLight();
    try {
      const { addedCount, skippedCount } = await addSongsToLocalPlaylist(playlistId, targetSongs);
      if (skippedCount > 0 && addedCount === 0) {
        Alert.alert("提示", "该歌曲已在歌单中");
      } else {
        onClose();
      }
    } catch (error) {
      Alert.alert("添加失败", error instanceof Error ? error.message : String(error));
    } finally {
      setAddingPlaylistId(null);
    }
  };

  const handleAddWy = async (playlistId: string) => {
    if (addingPlaylistId || addingWyPlaylistId || !primarySong || targetSongs.length !== 1) return;
    setAddingWyPlaylistId(playlistId);
    hapticLight();
    try {
      await addSongToWyPlaylist(playlistId, primarySong);
      onClose();
    } catch (error) {
      Alert.alert("添加失败", error instanceof Error ? error.message : String(error));
    } finally {
      setAddingWyPlaylistId(null);
    }
  };

  const handleCreateWithSong = async () => {
    const trimmed = newPlaylistName.trim();
    if (!trimmed || creating || addingPlaylistId || addingWyPlaylistId) return;
    setCreating(true);
    hapticLight();
    try {
      await createLocalPlaylistWithSongs({ name: trimmed, songs: targetSongs });
      setNewPlaylistName("");
      setShowCreateInput(false);
      onClose();
    } catch (error) {
      Alert.alert("创建失败", error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  const subtitle = targetSongs.length > 1
    ? `已选择 ${targetSongs.length} 首歌曲`
    : primarySong
    ? `${primarySong.name}${primarySong.singer ? ` · ${primarySong.singer}` : ""}`
    : "";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="关闭添加到歌单"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: palette.surface,
              maxHeight: windowHeight * 0.82,
              paddingBottom: Math.max(insets.bottom, spacing.m),
            },
          ]}
        >
          {/* 顶部胶囊拉手 */}
          <View style={styles.handleContainer}>
            <View style={[styles.handle, { backgroundColor: palette.border }]} />
          </View>

          {/* 标题栏 */}
          <View style={styles.header}>
            <View style={styles.titleGroup}>
              <Text style={[styles.title, { color: palette.text }]}>添加到歌单</Text>
              {subtitle ? (
                <Text style={[styles.subtitle, { color: palette.textMuted }]} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Touchable
              style={[styles.closeIconButton, { backgroundColor: palette.surfaceMuted }]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="关闭"
            >
              <X size={18} color={palette.textMuted} />
            </Touchable>
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* 新建歌单按钮 / 输入面板 */}
            {!showCreateInput ? (
              <Touchable
                style={[
                  styles.createEntryCard,
                  {
                    backgroundColor: withAlpha(palette.primary, 0.08),
                    borderColor: withAlpha(palette.primary, 0.2),
                  },
                ]}
                onPress={() => setShowCreateInput(true)}
                activeScale={0.98}
                accessibilityRole="button"
                accessibilityLabel="新建歌单"
              >
                <View style={[styles.plusCircle, { backgroundColor: palette.primary }]}>
                  <Plus size={18} color={palette.primaryText} />
                </View>
                <View style={styles.createEntryInfo}>
                  <Text style={[styles.createEntryTitle, { color: palette.primary }]}>
                    新建歌单并添加
                  </Text>
                  <Text style={[styles.createEntrySubtitle, { color: palette.textMuted }]}>
                    创建专属本地歌单
                  </Text>
                </View>
              </Touchable>
            ) : (
              <View
                style={[
                  styles.createInputBox,
                  { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
                ]}
              >
                <View style={styles.createInputRow}>
                  <TextInput
                    value={newPlaylistName}
                    onChangeText={setNewPlaylistName}
                    placeholder="输入新歌单名称"
                    placeholderTextColor={palette.textMuted}
                    autoFocus
                    maxLength={40}
                    style={[
                      styles.input,
                      {
                        backgroundColor: palette.surface,
                        borderColor: palette.border,
                        color: palette.text,
                      },
                    ]}
                  />
                  <Touchable
                    style={[
                      styles.confirmCreateBtn,
                      {
                        backgroundColor: newPlaylistName.trim() ? palette.primary : palette.border,
                      },
                    ]}
                    onPress={handleCreateWithSong}
                    disabled={!newPlaylistName.trim() || creating}
                    accessibilityRole="button"
                    accessibilityLabel="确认创建歌单"
                  >
                    {creating ? (
                      <ActivityIndicator size="small" color={palette.primaryText} />
                    ) : (
                      <Text style={[styles.confirmCreateText, { color: palette.primaryText }]}>
                        创建
                      </Text>
                    )}
                  </Touchable>
                </View>
                <Pressable
                  style={styles.cancelCreateLink}
                  onPress={() => {
                    setShowCreateInput(false);
                    setNewPlaylistName("");
                  }}
                >
                  <Text style={[styles.cancelCreateText, { color: palette.textSubtle }]}>
                    取消新建
                  </Text>
                </Pressable>
              </View>
            )}

            {/* 本地歌单列表 */}
            <View style={styles.sectionHeader}>
              <FolderHeart size={16} color={palette.primary} />
              <Text style={[styles.sectionTitle, { color: palette.text }]}>本地歌单</Text>
            </View>

            {emptyText ? (
              <View style={styles.emptyContainer}>
                <Text style={[styles.emptyText, { color: palette.textMuted }]}>{emptyText}</Text>
              </View>
            ) : (
              options.map((option) => {
                const isAdding = addingPlaylistId === option.id;
                return (
                  <Touchable
                    key={option.id}
                    style={[
                      styles.playlistItem,
                      option.containsSong && { opacity: 0.7 },
                    ]}
                    onPress={() => void handleAdd(option.id)}
                    disabled={option.containsSong || isAdding}
                    activeScale={0.98}
                    accessibilityRole="button"
                    accessibilityLabel={`${option.name}，${option.trackCount} 首歌曲`}
                  >
                    <View
                      style={[
                        styles.playlistIconBox,
                        {
                          backgroundColor: option.containsSong
                            ? palette.surfaceMuted
                            : withAlpha(palette.primary, 0.1),
                          overflow: "hidden",
                        },
                      ]}
                    >
                      {option.cover ? (
                        <CachedImage
                          uri={option.cover}
                          size={44}
                          style={{ width: "100%", height: "100%" }}
                          fallback={
                            <ListMusic
                              size={20}
                              color={option.containsSong ? palette.textMuted : palette.primary}
                            />
                          }
                        />
                      ) : (
                        <ListMusic
                          size={20}
                          color={option.containsSong ? palette.textMuted : palette.primary}
                        />
                      )}
                    </View>
                    <View style={styles.playlistInfo}>
                      <Text
                        style={[styles.playlistName, { color: palette.text }]}
                        numberOfLines={1}
                      >
                        {option.name}
                      </Text>
                      <Text style={[styles.playlistCount, { color: palette.textMuted }]}>
                        {option.trackCount} 首歌曲
                      </Text>
                    </View>
                    {isAdding ? (
                      <ActivityIndicator color={palette.primary} size="small" />
                    ) : option.containsSong ? (
                      <View style={styles.badgeAdded}>
                        <Check size={14} color={palette.textMuted} />
                        <Text style={[styles.badgeAddedText, { color: palette.textMuted }]}>
                          已添加
                        </Text>
                      </View>
                    ) : (
                      <Text style={[styles.badgeAddAction, { color: palette.primary }]}>
                        添加
                      </Text>
                    )}
                  </Touchable>
                );
              })
            )}

            {/* 网易云自建歌单 */}
            <View style={[styles.sectionHeader, styles.remoteSectionHeader]}>
              <Cloud size={16} color={palette.primary} />
              <Text style={[styles.sectionTitle, { color: palette.text }]}>网易云自建歌单</Text>
            </View>

            {wyEmptyText ? (
              <View style={styles.emptyContainer}>
                <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                  {wyEmptyText}
                </Text>
              </View>
            ) : (
              wyOptions.map((option) => {
                const isAddingWy = addingWyPlaylistId === option.id;
                return (
                  <Touchable
                    key={option.id}
                    style={styles.playlistItem}
                    onPress={() => void handleAddWy(option.id)}
                    disabled={isAddingWy}
                    activeScale={0.98}
                    accessibilityRole="button"
                    accessibilityLabel={`${option.name}，${option.trackCount} 首歌曲`}
                  >
                    <View
                      style={[
                        styles.playlistIconBox,
                        { backgroundColor: withAlpha(palette.primary, 0.1) },
                      ]}
                    >
                      <Cloud size={20} color={palette.primary} />
                    </View>
                    <View style={styles.playlistInfo}>
                      <Text
                        style={[styles.playlistName, { color: palette.text }]}
                        numberOfLines={1}
                      >
                        {option.name}
                      </Text>
                      <Text style={[styles.playlistCount, { color: palette.textMuted }]}>
                        {option.trackCount} 首歌曲
                      </Text>
                    </View>
                    {isAddingWy ? (
                      <ActivityIndicator color={palette.primary} size="small" />
                    ) : (
                      <Text style={[styles.badgeAddAction, { color: palette.primary }]}>
                        添加
                      </Text>
                    )}
                  </Touchable>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function getSongKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 20,
  },
  handleContainer: {
    alignItems: "center",
    paddingVertical: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.s,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  titleGroup: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: typography.title,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: typography.caption,
  },
  closeIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  scrollArea: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
  },
  createEntryCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.m,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.m,
    marginBottom: spacing.m,
  },
  plusCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  createEntryInfo: {
    flex: 1,
    gap: 2,
  },
  createEntryTitle: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  createEntrySubtitle: {
    fontSize: typography.caption,
  },
  createInputBox: {
    padding: spacing.m,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.s,
    marginBottom: spacing.m,
  },
  createInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  input: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.m,
    fontSize: typography.body,
  },
  confirmCreateBtn: {
    height: 42,
    paddingHorizontal: spacing.l,
    borderRadius: radius.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  confirmCreateText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  cancelCreateLink: {
    alignSelf: "flex-end",
    paddingVertical: 2,
  },
  cancelCreateText: {
    fontSize: typography.caption,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
    marginBottom: spacing.s,
  },
  remoteSectionHeader: {
    marginTop: spacing.l,
  },
  sectionTitle: {
    fontSize: typography.caption,
    fontWeight: "700",
  },
  playlistItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.s,
    gap: spacing.m,
  },
  playlistIconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  playlistInfo: {
    flex: 1,
    gap: 3,
  },
  playlistName: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  playlistCount: {
    fontSize: typography.caption,
  },
  badgeAdded: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: spacing.s,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  badgeAddedText: {
    fontSize: typography.caption,
    fontWeight: "500",
  },
  badgeAddAction: {
    fontSize: typography.body,
    fontWeight: "600",
    paddingHorizontal: spacing.s,
    paddingVertical: 4,
  },
  emptyContainer: {
    paddingVertical: spacing.l,
    alignItems: "center",
  },
  emptyText: {
    fontSize: typography.caption,
  },
});
