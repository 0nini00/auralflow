import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { MusicInfo } from "@lx/core";

import {
  buildOwnedWyPlaylistSongOptions,
  buildLocalPlaylistSongOptions,
  getAddToWyPlaylistEmptyText,
  getAddToLocalPlaylistEmptyText,
} from "@/services/localPlaylistSelectionModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import { radius, spacing } from "@/theme/tokens";

interface AddToLocalPlaylistModalProps {
  visible: boolean;
  song?: MusicInfo;
  songs?: MusicInfo[];
  onClose: () => void;
}

export function AddToLocalPlaylistModal({ visible, song, songs, onClose }: AddToLocalPlaylistModalProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
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

  const options = useMemo(() => {
    if (!primarySong) return [];
    if (targetSongs.length === 1) return buildLocalPlaylistSongOptions(localPlaylists, primarySong);
    const targetKeys = new Set(targetSongs.map(getSongKey));
    return localPlaylists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      trackCount: playlist.songs.length,
      containsSong: playlist.songs.filter((item) => targetKeys.has(getSongKey(item))).length === targetKeys.size,
    }));
  }, [localPlaylists, primarySong, targetSongs]);
  const emptyText = targetSongs.length === 0 ? "没有可添加的歌曲" : getAddToLocalPlaylistEmptyText(options);
  const wyOptions = useMemo(
    () => targetSongs.length === 1 && primarySong ? buildOwnedWyPlaylistSongOptions(playlists, primarySong) : [],
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
    try {
      const { addedCount, skippedCount } = await addSongsToLocalPlaylist(playlistId, targetSongs);
      Alert.alert("添加完成", `已添加 ${addedCount} 首，跳过 ${skippedCount} 首重复歌曲`);
    } catch (error) {
      Alert.alert("添加失败", error instanceof Error ? error.message : String(error));
    } finally {
      setAddingPlaylistId(null);
    }
  };

  const handleAddWy = async (playlistId: string) => {
    if (addingPlaylistId || addingWyPlaylistId || !primarySong || targetSongs.length !== 1) return;
    setAddingWyPlaylistId(playlistId);
    try {
      await addSongToWyPlaylist(playlistId, primarySong);
    } catch (error) {
      Alert.alert("添加失败", error instanceof Error ? error.message : String(error));
    } finally {
      setAddingWyPlaylistId(null);
    }
  };


  const handleCreateWithSong = async () => {
    if (creating || addingPlaylistId || addingWyPlaylistId) return;
    setCreating(true);
    try {
      await createLocalPlaylistWithSongs({ name: newPlaylistName, songs: targetSongs });
      setNewPlaylistName("");
    } catch (error) {
      Alert.alert("创建失败", error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView contentContainerStyle={[styles.container, { backgroundColor: palette.background }]}> 
        <View style={styles.header}>
          <View style={styles.titleGroup}>
            <Text style={[styles.title, { color: palette.text }]}>添加到歌单</Text>
            <Text style={[styles.subtitle, { color: palette.textMuted }]} numberOfLines={1}>
              {targetSongs.length > 1 ? `已选择 ${targetSongs.length} 首歌曲` : primarySong?.name ?? ""}
            </Text>
          </View>
          <Pressable onPress={onClose}>
            <Text style={[styles.closeText, { color: palette.primary }]}>关闭</Text>
          </Pressable>
        </View>


        <View style={[styles.createBox, { backgroundColor: palette.surface }]}> 
          <View style={styles.createInfo}>
            <Text style={[styles.createTitle, { color: palette.text }]}>新建歌单并添加</Text>
            <Text style={[styles.createCaption, { color: palette.textMuted }]}>不用离开当前歌曲列表</Text>
          </View>
          <TextInput
            value={newPlaylistName}
            onChangeText={setNewPlaylistName}
            placeholder="输入新歌单名称"
            placeholderTextColor={palette.textMuted}
            style={[styles.input, { borderColor: palette.border, color: palette.text }]}
          />
          <Pressable
            style={[styles.createButton, { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1 }]}
            onPress={handleCreateWithSong}
            disabled={targetSongs.length === 0 || creating || addingPlaylistId !== null || addingWyPlaylistId !== null}
          >
            {creating ? (
              <ActivityIndicator color={palette.primary} size="small" />
            ) : (
              <Text style={[styles.createButtonText, { color: palette.primary }]}>创建并添加</Text>
            )}
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: palette.text }]}>本地歌单</Text>
        {emptyText ? (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: palette.textMuted }]}>{emptyText}</Text>
          </View>
        ) : (
          options.map((option) => (
            <Pressable
              key={option.id}
              style={[styles.item, { backgroundColor: palette.surface }]}
              onPress={() => void handleAdd(option.id)}
              disabled={option.containsSong || addingPlaylistId !== null || addingWyPlaylistId !== null}
            >
              <View style={styles.itemInfo}>
                <Text style={[styles.itemTitle, { color: palette.text }]} numberOfLines={1}>{option.name}</Text>
                <Text style={[styles.itemMeta, { color: palette.textMuted }]}>{option.trackCount} 首歌曲</Text>
              </View>
              {addingPlaylistId === option.id ? (
                <ActivityIndicator color={palette.primary} size="small" />
              ) : (
                <Text style={[styles.itemAction, { color: option.containsSong ? palette.textMuted : palette.primary }]}>
                  {option.containsSong ? "已添加" : "添加"}
                </Text>
              )}
            </Pressable>
          ))
        )}

        <Text style={[styles.sectionTitle, styles.remoteSectionTitle, { color: palette.text }]}>网易云自建歌单</Text>
        {wyEmptyText ? (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: palette.textMuted }]}>{wyEmptyText}</Text>
          </View>
        ) : (
          wyOptions.map((option) => (
            <Pressable
              key={option.id}
              style={[styles.item, { backgroundColor: palette.surface }]}
              onPress={() => void handleAddWy(option.id)}
              disabled={addingPlaylistId !== null || addingWyPlaylistId !== null}
            >
              <View style={styles.itemInfo}>
                <Text style={[styles.itemTitle, { color: palette.text }]} numberOfLines={1}>{option.name}</Text>
                <Text style={[styles.itemMeta, { color: palette.textMuted }]}>{option.trackCount} 首歌曲</Text>
              </View>
              {addingWyPlaylistId === option.id ? (
                <ActivityIndicator color={palette.primary} size="small" />
              ) : (
                <Text style={[styles.itemAction, { color: palette.primary }]}>添加</Text>
              )}
            </Pressable>
          ))
        )}
      </ScrollView>
    </Modal>
  );
}

function getSongKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 100,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  titleGroup: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 13,
  },
  closeText: {
    fontSize: 15,
    fontWeight: "600",
  },

  createBox: {
    borderRadius: radius.md,
    padding: spacing.s,
    gap: 10,
    marginBottom: spacing.m,
  },
  createInfo: {
    gap: 4,
  },
  createTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  createCaption: {
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  createButton: {
    minHeight: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  createButtonText: {
    fontSize: 14,
    fontWeight: "700",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 8,
  },
  remoteSectionTitle: {
    marginTop: 12,
  },
  emptyContainer: {
    paddingVertical: 24,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: radius.sm,
    marginBottom: 8,
    gap: 12,
  },
  itemInfo: {
    flex: 1,
    gap: 4,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  itemMeta: {
    fontSize: 12,
  },
  itemAction: {
    fontSize: 14,
    fontWeight: "700",
  },
});
