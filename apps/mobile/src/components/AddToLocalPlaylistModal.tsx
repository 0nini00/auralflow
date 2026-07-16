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

interface AddToLocalPlaylistModalProps {
  visible: boolean;
  song: MusicInfo;
  onClose: () => void;
}

export function AddToLocalPlaylistModal({ visible, song, onClose }: AddToLocalPlaylistModalProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const playlists = usePlaylistStore((state) => state.playlists);
  const localPlaylists = usePlaylistStore((state) => state.localPlaylists);
  const addSongToLocalPlaylist = usePlaylistStore((state) => state.addSongToLocalPlaylist);
  const addSongToWyPlaylist = usePlaylistStore((state) => state.addSongToWyPlaylist);
  const createLocalPlaylistWithSong = usePlaylistStore((state) => state.createLocalPlaylistWithSong);
  const [addingPlaylistId, setAddingPlaylistId] = useState<string | null>(null);
  const [addingWyPlaylistId, setAddingWyPlaylistId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [creating, setCreating] = useState(false);

  const options = useMemo(
    () => buildLocalPlaylistSongOptions(localPlaylists, song),
    [localPlaylists, song],
  );
  const emptyText = getAddToLocalPlaylistEmptyText(options);
  const wyOptions = useMemo(
    () => buildOwnedWyPlaylistSongOptions(playlists, song),
    [playlists, song],
  );
  const wyEmptyText = getAddToWyPlaylistEmptyText(wyOptions, song);

  const handleAdd = async (playlistId: string) => {
    if (addingPlaylistId || addingWyPlaylistId) return;
    setAddingPlaylistId(playlistId);
    try {
      await addSongToLocalPlaylist(playlistId, song);
    } catch (error) {
      Alert.alert("添加失败", error instanceof Error ? error.message : String(error));
    } finally {
      setAddingPlaylistId(null);
    }
  };

  const handleAddWy = async (playlistId: string) => {
    if (addingPlaylistId || addingWyPlaylistId) return;
    setAddingWyPlaylistId(playlistId);
    try {
      await addSongToWyPlaylist(playlistId, song);
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
      await createLocalPlaylistWithSong({ name: newPlaylistName, song });
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
            <Text style={[styles.subtitle, { color: palette.textMuted }]} numberOfLines={1}>{song.name}</Text>
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
            style={[styles.createButton, { backgroundColor: palette.primary }]}
            onPress={handleCreateWithSong}
            disabled={creating || addingPlaylistId !== null || addingWyPlaylistId !== null}
          >
            {creating ? (
              <ActivityIndicator color={palette.primaryText} size="small" />
            ) : (
              <Text style={[styles.createButtonText, { color: palette.primaryText }]}>创建并添加</Text>
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
    borderRadius: 12,
    padding: 12,
    gap: 10,
    marginBottom: 16,
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
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  createButton: {
    minHeight: 40,
    borderRadius: 8,
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
    borderRadius: 8,
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
