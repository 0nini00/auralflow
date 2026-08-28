import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";

import { AccountInfo } from "@/components/AccountInfo";
import { LocalPlaylistList } from "@/components/LocalPlaylistList";
import { PlaylistList } from "@/components/PlaylistList";
import { QuickActionCard } from "@/components/QuickActionCard";
import { ActionButton } from "@/components/ActionButton";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import { useThemeStore, getResolvedTheme, getThemePalette } from "@/stores/themeStore";
import { useAccountStore } from "@/stores/accountStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import {
  openLikedSongsScreen,
  openLocalPlaylistDetailScreen,
  openPlaylistDetailScreen,
} from "@/navigation/navigationRef";
import { buildLibraryQuickActions } from "@/services/libraryQuickActions";
import { buildWyPlaylistGroups } from "@/services/libraryPlaylistGroups";
import type { LibraryQuickActionType } from "@/services/libraryQuickActions";
import type { LocalPlaylist } from "@/services/localPlaylistModel";
import {
  importPlaylistsFromJsonInput,
  shareExportedPlaylists,
} from "@/services/playlistTransferService";
import { radius, spacing, typography } from "@/theme/tokens";
import { touch } from "@/theme/tokens";

interface MyMusicScreenProps {
  onNavigateToPlayer: () => void;
}

/**
 * 我的 —— 账号 + 快捷入口 + 本地歌单（含管理）+ 网易云歌单。
 * 收敛"私人资产"：本地/网易云歌单都在这里聚合，替代原先三个空占位 tab。
 */
export function MyMusicScreen({ onNavigateToPlayer }: MyMusicScreenProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const user = useAccountStore((state) => state.user);
  const checkStatus = useAccountStore((state) => state.checkStatus);

  const playlists = usePlaylistStore((state) => state.playlists);
  const likedPlaylist = usePlaylistStore((state) => state.likedPlaylist);
  const likedSongs = usePlaylistStore((state) => state.likedSongs);
  const localPlaylists = usePlaylistStore((state) => state.localPlaylists);
  const fetchPlaylists = usePlaylistStore((state) => state.fetchPlaylists);
  const fetchLikedSongs = usePlaylistStore((state) => state.fetchLikedSongs);
  const loadLikedSongsFromStorage = usePlaylistStore((state) => state.loadLikedSongsFromStorage);
  const loadLocalPlaylists = usePlaylistStore((state) => state.loadLocalPlaylists);
  const createLocalPlaylist = usePlaylistStore((state) => state.createLocalPlaylist);
  const updateLocalPlaylistInfo = usePlaylistStore((state) => state.updateLocalPlaylistInfo);
  const updateWyPlaylistInfo = usePlaylistStore((state) => state.updateWyPlaylistInfo);

  const [showCreateLocalPlaylistModal, setShowCreateLocalPlaylistModal] = useState(false);
  const [showImportLocalPlaylistModal, setShowImportLocalPlaylistModal] = useState(false);
  const [localPlaylistName, setLocalPlaylistName] = useState("");
  const [localPlaylistDescription, setLocalPlaylistDescription] = useState("");
  const [localPlaylistImportJson, setLocalPlaylistImportJson] = useState("");
  const [editingLocalPlaylistId, setEditingLocalPlaylistId] = useState<string | null>(null);
  const [creatingLocalPlaylist, setCreatingLocalPlaylist] = useState(false);
  const [importingLocalPlaylists, setImportingLocalPlaylists] = useState(false);
  const [exportingLocalPlaylists, setExportingLocalPlaylists] = useState(false);
  // 网易云自建歌单新建/编辑
  const createWyPlaylist = usePlaylistStore((state) => state.createWyPlaylist);
  const [showCreateWyPlaylistModal, setShowCreateWyPlaylistModal] = useState(false);
  const [editingWyPlaylistId, setEditingWyPlaylistId] = useState<string | null>(null);
  const [wyPlaylistName, setWyPlaylistName] = useState("");
  const [wyPlaylistDescription, setWyPlaylistDescription] = useState("");
  const [creatingWyPlaylist, setCreatingWyPlaylist] = useState(false);
  const [wyRefreshing, setWyRefreshing] = useState(false);

  const handleRefreshWyPlaylists = async () => {
    if (!isLoggedIn || !user || wyRefreshing) return;
    setWyRefreshing(true);
    try {
      await fetchPlaylists(user.userId);
    } finally {
      setWyRefreshing(false);
    }
  };

  const closeWyPlaylistEditor = () => {
    setEditingWyPlaylistId(null);
    setWyPlaylistName("");
    setWyPlaylistDescription("");
    setShowCreateWyPlaylistModal(false);
  };

  const openCreateWyPlaylist = () => {
    if (!isLoggedIn) return;
    setEditingWyPlaylistId(null);
    setWyPlaylistName("");
    setWyPlaylistDescription("");
    setShowCreateWyPlaylistModal(true);
  };

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    void loadLikedSongsFromStorage();
    void loadLocalPlaylists();
  }, [loadLikedSongsFromStorage, loadLocalPlaylists]);

  useEffect(() => {
    if (isLoggedIn && user) {
      fetchPlaylists(user.userId);
      fetchLikedSongs(user.userId);
    }
  }, [isLoggedIn, user, fetchPlaylists, fetchLikedSongs]);

  const wyPlaylistGroups = useMemo(
    () => buildWyPlaylistGroups(playlists, user?.userId, likedPlaylist?.id),
    [playlists, user?.userId, likedPlaylist?.id],
  );
  const quickActions = buildLibraryQuickActions({
    isLoggedIn,
    likedPlaylistTrackCount: likedPlaylist?.trackCount ?? null,
    likedSongsCount: likedSongs.length,
    likedCoverUri: likedSongs[0]?.img || likedSongs[0]?.picUrl || null,
  });

  const handleQuickAction = (action: LibraryQuickActionType) => {
    switch (action) {
      case "openLikedPlaylist":
        if (likedPlaylist) {
          openPlaylistDetailScreen(likedPlaylist);
          return;
        }
        if (likedSongs.length > 0) {
          openLikedSongsScreen();
        }
        return;
    }
  };

  const handleLocalPlaylistPress = (playlist: LocalPlaylist) => {
    openLocalPlaylistDetailScreen(playlist.id);
  };

  const openLocalPlaylistEditor = (playlist?: LocalPlaylist) => {
    setEditingLocalPlaylistId(playlist?.id ?? null);
    setLocalPlaylistName(playlist?.name ?? "");
    setLocalPlaylistDescription(playlist?.description ?? "");
    setShowCreateLocalPlaylistModal(true);
  };

  const closeLocalPlaylistEditor = () => {
    setEditingLocalPlaylistId(null);
    setLocalPlaylistName("");
    setLocalPlaylistDescription("");
    setShowCreateLocalPlaylistModal(false);
  };

  const handleCreateLocalPlaylist = async () => {
    if (creatingLocalPlaylist) return;
    setCreatingLocalPlaylist(true);
    try {
      if (editingLocalPlaylistId) {
        await updateLocalPlaylistInfo(editingLocalPlaylistId, {
          name: localPlaylistName,
          description: localPlaylistDescription,
        });
      } else {
        await createLocalPlaylist({ name: localPlaylistName, description: localPlaylistDescription });
      }
      closeLocalPlaylistEditor();
    } catch (error) {
      Alert.alert(editingLocalPlaylistId ? "编辑失败" : "创建失败", error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingLocalPlaylist(false);
    }
  };

  const handleExportLocalPlaylists = async () => {
    if (exportingLocalPlaylists) return;
    if (localPlaylists.length === 0) {
      Alert.alert("提示", "没有可导出的本地歌单");
      return;
    }
    setExportingLocalPlaylists(true);
    try {
      await shareExportedPlaylists();
    } catch (error) {
      Alert.alert("导出失败", error instanceof Error ? error.message : String(error));
    } finally {
      setExportingLocalPlaylists(false);
    }
  };

  const handleImportLocalPlaylists = async () => {
    if (importingLocalPlaylists) return;
    setImportingLocalPlaylists(true);
    try {
      const result = await importPlaylistsFromJsonInput(localPlaylistImportJson);
      if (!result.imported) {
        Alert.alert("导入成功", "没有新增歌曲");
        return;
      }
      setLocalPlaylistImportJson("");
      setShowImportLocalPlaylistModal(false);
      Alert.alert("导入成功", `已导入 ${result.addedSongCount} 首歌`);
    } catch (error) {
      Alert.alert("导入失败", error instanceof Error ? error.message : String(error));
    } finally {
      setImportingLocalPlaylists(false);
    }
  };

  const handleCreateWyPlaylist = async () => {
    if (creatingWyPlaylist) return;
    const name = wyPlaylistName.trim();
    if (!name) {
      Alert.alert("提示", "请输入歌单名称");
      return;
    }
    const description = wyPlaylistDescription.trim();
    setCreatingWyPlaylist(true);
    try {
      if (editingWyPlaylistId) {
        await updateWyPlaylistInfo(editingWyPlaylistId, { name, description });
        if (user) {
          await fetchPlaylists(user.userId);
        }
      } else {
        await createWyPlaylist(name, description);
      }
      closeWyPlaylistEditor();
    } catch (error) {
      Alert.alert(
        editingWyPlaylistId ? "保存失败" : "创建失败",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setCreatingWyPlaylist(false);
    }
  };

  return (
    <ScreenScaffold>
      <ScreenScrollView>
        <View style={styles.account}>
          <AccountInfo />
        </View>

        <SectionHeader title="我的" description="我喜欢的、本地与网易云歌单。" style={styles.section} />

        <View style={styles.quickActions}>
          {quickActions.map((action) => (
            <QuickActionCard
              key={action.action}
              title={action.title}
              subtitle={action.subtitle}
              coverUri={action.coverUri}
              disabled={action.disabled}
              grow
              onPress={() => handleQuickAction(action.action)}
            />
          ))}
        </View>

        <View style={styles.playlistGroup}>
          <SectionHeader
            title="本地歌单"
            description={`${localPlaylists.length} 个`}
            action={(
              <View style={styles.playlistHeaderActions}>
                <ActionButton
                  small
                  accessibilityLabel="导入本地歌单"
                  onPress={() => setShowImportLocalPlaylistModal(true)}
                  label="导入"
                />
                <ActionButton
                  small
                  accessibilityLabel="导出本地歌单"
                  onPress={handleExportLocalPlaylists}
                  loading={exportingLocalPlaylists}
                  label="导出"
                />
                <ActionButton
                  small
                  accessibilityLabel="新建本地歌单"
                  onPress={() => openLocalPlaylistEditor()}
                  label="新建"
                />
              </View>
            )}
          />
          <LocalPlaylistList
            playlists={localPlaylists}
            onPress={handleLocalPlaylistPress}
            emptyText="还没有本地歌单，点击新建开始整理"
          />
        </View>

        {wyPlaylistGroups.map((group) => (
          <View key={group.key} style={styles.playlistGroup}>
            <SectionHeader
              title={group.title}
              description={`${group.count} 个`}
              action={group.key === "owned" && isLoggedIn ? (
                <View style={styles.playlistHeaderActions}>
                  <ActionButton
                    small
                    accessibilityLabel="刷新网易云歌单"
                    onPress={handleRefreshWyPlaylists}
                    loading={wyRefreshing}
                    label="刷新"
                  />
                  <ActionButton
                    small
                    accessibilityLabel="新建网易云歌单"
                    onPress={openCreateWyPlaylist}
                    label="新建"
                  />
                </View>
              ) : undefined}
            />
            <PlaylistList
              playlists={group.playlists}
              onPress={openPlaylistDetailScreen}
              emptyText={group.emptyText}
            />
          </View>
        ))}

        <Modal
          visible={showCreateLocalPlaylistModal}
          animationType="slide"
          transparent
          onRequestClose={closeLocalPlaylistEditor}
        >
          <KeyboardAvoidingView
            style={styles.createModalOverlay}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View style={[styles.createModalCard, { backgroundColor: palette.surface }]}>
              <Text style={[styles.createModalTitle, { color: palette.text }]}>
                {editingLocalPlaylistId ? "编辑本地歌单" : "新建本地歌单"}
              </Text>
              <TextInput
                value={localPlaylistName}
                onChangeText={setLocalPlaylistName}
                placeholder="输入歌单名称"
                placeholderTextColor={palette.textMuted}
                style={[styles.createInput, { borderColor: palette.border, color: palette.text }]}
              />
              <TextInput
                value={localPlaylistDescription}
                onChangeText={setLocalPlaylistDescription}
                placeholder="简介（可选）"
                placeholderTextColor={palette.textMuted}
                multiline
                style={[styles.createInput, styles.createTextArea, { borderColor: palette.border, color: palette.text }]}
              />
              <View style={styles.createModalActions}>
                <Pressable
                  style={styles.createModalButton}
                  onPress={closeLocalPlaylistEditor}
                  disabled={creatingLocalPlaylist}
                >
                  <Text style={[styles.createModalButtonText, { color: palette.textMuted }]}>取消</Text>
                </Pressable>
                <Pressable
                  style={[styles.createModalButton, { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1 }]}
                  onPress={handleCreateLocalPlaylist}
                  disabled={creatingLocalPlaylist}
                >
                  {creatingLocalPlaylist ? (
                    <ActivityIndicator color={palette.primary} size="small" />
                  ) : (
                    <Text style={[styles.createModalButtonText, { color: palette.primary }]}>
                      {editingLocalPlaylistId ? "保存" : "创建"}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal
          visible={showCreateWyPlaylistModal}
          animationType="slide"
          transparent
          onRequestClose={closeWyPlaylistEditor}
        >
          <KeyboardAvoidingView
            style={styles.createModalOverlay}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View style={[styles.createModalCard, { backgroundColor: palette.surface }]}>
              <Text style={[styles.createModalTitle, { color: palette.text }]}>
                {editingWyPlaylistId ? "编辑网易云歌单" : "新建网易云歌单"}
              </Text>
              <TextInput
                value={wyPlaylistName}
                onChangeText={setWyPlaylistName}
                placeholder="输入歌单名称"
                placeholderTextColor={palette.textMuted}
                style={[styles.createInput, { borderColor: palette.border, color: palette.text }]}
              />
              <TextInput
                value={wyPlaylistDescription}
                onChangeText={setWyPlaylistDescription}
                placeholder="简介（可选）"
                placeholderTextColor={palette.textMuted}
                multiline
                style={[styles.createInput, styles.createTextArea, { borderColor: palette.border, color: palette.text }]}
              />
              <View style={styles.createModalActions}>
                <Pressable
                  style={styles.createModalButton}
                  onPress={closeWyPlaylistEditor}
                  disabled={creatingWyPlaylist}
                >
                  <Text style={[styles.createModalButtonText, { color: palette.textMuted }]}>取消</Text>
                </Pressable>
                <Pressable
                  style={[styles.createModalButton, { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1 }]}
                  onPress={handleCreateWyPlaylist}
                  disabled={creatingWyPlaylist}
                >
                  {creatingWyPlaylist ? (
                    <ActivityIndicator color={palette.primary} size="small" />
                  ) : (
                    <Text style={[styles.createModalButtonText, { color: palette.primary }]}>
                      {editingWyPlaylistId ? "保存" : "创建"}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal
          visible={showImportLocalPlaylistModal}
          animationType="slide"
          transparent
          onRequestClose={() => setShowImportLocalPlaylistModal(false)}
        >
          <KeyboardAvoidingView
            style={styles.createModalOverlay}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View style={[styles.createModalCard, { backgroundColor: palette.surface }]}>
              <Text style={[styles.createModalTitle, { color: palette.text }]}>导入本地歌单</Text>
              <TextInput
                value={localPlaylistImportJson}
                onChangeText={setLocalPlaylistImportJson}
                placeholder="粘贴从 AuralFlow 导出的 JSON"
                placeholderTextColor={palette.textMuted}
                multiline
                style={[styles.createInput, styles.importTextArea, { borderColor: palette.border, color: palette.text }]}
              />
              <View style={styles.createModalActions}>
                <Pressable
                  style={styles.createModalButton}
                  onPress={() => setShowImportLocalPlaylistModal(false)}
                  disabled={importingLocalPlaylists}
                >
                  <Text style={[styles.createModalButtonText, { color: palette.textMuted }]}>取消</Text>
                </Pressable>
                <Pressable
                  style={[styles.createModalButton, { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1 }]}
                  onPress={handleImportLocalPlaylists}
                  disabled={importingLocalPlaylists}
                >
                  {importingLocalPlaylists ? (
                    <ActivityIndicator color={palette.primary} size="small" />
                  ) : (
                    <Text style={[styles.createModalButtonText, { color: palette.primary }]}>导入</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.m,
  },
  account: {
    marginBottom: spacing.m,
  },
  quickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.m,
    marginBottom: spacing.l,
  },
  playlistGroup: {
    gap: spacing.s,
    marginBottom: spacing.l,
  },
  playlistHeaderActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: spacing.xs,
  },
  createModalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  createModalCard: {
    borderRadius: radius.lg,
    padding: spacing.l,
    gap: spacing.m,
  },
  createModalTitle: {
    fontSize: typography.heading,
    fontWeight: "700",
  },
  createInput: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: typography.title,
  },
  createTextArea: {
    minHeight: 76,
    textAlignVertical: "top",
  },
  importTextArea: {
    minHeight: 160,
    textAlignVertical: "top",
  },
  createModalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.s,
  },
  createModalButton: {
    minWidth: 80,
    minHeight: touch.minTarget,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  createModalButtonText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
});
