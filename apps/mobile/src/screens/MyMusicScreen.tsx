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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Cloud, FileJson, FolderPlus, X } from "lucide-react-native";

import { AccountInfo } from "@/components/AccountInfo";
import { ImportPlaylistLinkModal } from "@/components/ImportPlaylistLinkModal";
import { LocalPlaylistList } from "@/components/LocalPlaylistList";
import { PlaylistList } from "@/components/PlaylistList";
import { QuickActionCard } from "@/components/QuickActionCard";
import { ActionButton } from "@/components/ActionButton";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import { useThemeStore, getResolvedTheme, getThemePalette } from "@/stores/themeStore";
import { useAccountStore } from "@/stores/accountStore";
import { useFavoritesStore } from "@/stores/favoritesStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import {
  openFollowedArtistsScreen,
  openLikedSongsScreen,
  openLocalPlaylistDetailScreen,
  openPlaylistDetailScreen,
  openSubscribedAlbumsScreen,
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
  const insets = useSafeAreaInsets();
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const user = useAccountStore((state) => state.user);
  const checkStatus = useAccountStore((state) => state.checkStatus);

  const playlists = usePlaylistStore((state) => state.playlists);
  const localPlaylists = usePlaylistStore((state) => state.localPlaylists);
  const fetchPlaylists = usePlaylistStore((state) => state.fetchPlaylists);
  const loadLocalPlaylists = usePlaylistStore((state) => state.loadLocalPlaylists);
  // "我喜欢" = 本地收藏（对齐桌面端），与网易云登录态无关
  const favorites = useFavoritesStore((state) => state.favorites);
  const loadFavorites = useFavoritesStore((state) => state.loadFromStorage);
  const createLocalPlaylist = usePlaylistStore((state) => state.createLocalPlaylist);
  const updateLocalPlaylistInfo = usePlaylistStore((state) => state.updateLocalPlaylistInfo);
  const updateWyPlaylistInfo = usePlaylistStore((state) => state.updateWyPlaylistInfo);

  const [showCreateLocalPlaylistModal, setShowCreateLocalPlaylistModal] = useState(false);
  const [showImportLocalPlaylistModal, setShowImportLocalPlaylistModal] = useState(false);
  const [showImportLinkModal, setShowImportLinkModal] = useState(false);
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
    void loadFavorites();
    void loadLocalPlaylists();
  }, [loadFavorites, loadLocalPlaylists]);

  useEffect(() => {
    if (isLoggedIn && user) {
      fetchPlaylists(user.userId);
    }
  }, [isLoggedIn, user, fetchPlaylists]);

  // "我喜欢的音乐"（网易云自建的首个歌单）不进"创建的歌单"分组，按名称识别
  const wyLikedPlaylistId = useMemo(
    () => playlists.find((playlist) => playlist.source === "wy" && playlist.name === "我喜欢的音乐")?.id,
    [playlists],
  );
  const wyPlaylistGroups = useMemo(
    () => buildWyPlaylistGroups(playlists, user?.userId, wyLikedPlaylistId),
    [playlists, user?.userId, wyLikedPlaylistId],
  );
  const quickActions = buildLibraryQuickActions({
    favoritesCount: favorites.length,
    likedCoverUri: favorites[0]?.img || favorites[0]?.picUrl || null,
    isWyLoggedIn: isLoggedIn,
  });

  const handleQuickAction = (action: LibraryQuickActionType) => {
    switch (action) {
      case "openLikedPlaylist":
        openLikedSongsScreen();
        return;
      case "openFollowedArtists":
        openFollowedArtistsScreen();
        return;
      case "openSubscribedAlbums":
        openSubscribedAlbumsScreen();
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
                  accessibilityLabel="从链接导入歌单"
                  onPress={() => setShowImportLinkModal(true)}
                  label="链接"
                />
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
          statusBarTranslucent
          onRequestClose={closeLocalPlaylistEditor}
        >
          <View style={styles.createModalOverlay}>
            <Pressable
              style={styles.createModalBackdrop}
              onPress={closeLocalPlaylistEditor}
              accessibilityRole="button"
              accessibilityLabel="关闭"
            />
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              style={styles.createModalKeyboardWrap}
            >
              <View
                style={[
                  styles.createModalCard,
                  {
                    backgroundColor: palette.surface,
                    paddingBottom: Math.max(insets.bottom, spacing.m),
                  },
                ]}
              >
                <View style={styles.sheetHandleContainer}>
                  <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
                </View>

                <View style={styles.sheetHeader}>
                  <View style={styles.titleWithIcon}>
                    <FolderPlus size={18} color={palette.primary} />
                    <Text style={[styles.createModalTitle, { color: palette.text }]}>
                      {editingLocalPlaylistId ? "编辑本地歌单" : "新建本地歌单"}
                    </Text>
                  </View>
                  <Pressable
                    style={[styles.closeIconButton, { backgroundColor: palette.surfaceMuted }]}
                    onPress={closeLocalPlaylistEditor}
                    accessibilityRole="button"
                    accessibilityLabel="关闭"
                  >
                    <X size={18} color={palette.textMuted} />
                  </Pressable>
                </View>

                <View style={styles.modalFormBody}>
                  <TextInput
                    value={localPlaylistName}
                    onChangeText={setLocalPlaylistName}
                    placeholder="输入歌单名称"
                    placeholderTextColor={palette.textMuted}
                    style={[
                      styles.createInput,
                      {
                        backgroundColor: palette.surfaceMuted,
                        borderColor: palette.border,
                        color: palette.text,
                      },
                    ]}
                  />
                  <TextInput
                    value={localPlaylistDescription}
                    onChangeText={setLocalPlaylistDescription}
                    placeholder="简介（可选）"
                    placeholderTextColor={palette.textMuted}
                    multiline
                    style={[
                      styles.createInput,
                      styles.createTextArea,
                      {
                        backgroundColor: palette.surfaceMuted,
                        borderColor: palette.border,
                        color: palette.text,
                      },
                    ]}
                  />
                  <View style={styles.createModalActions}>
                    <Pressable
                      style={[styles.cancelModalButton, { backgroundColor: palette.surfaceMuted }]}
                      onPress={closeLocalPlaylistEditor}
                      disabled={creatingLocalPlaylist}
                    >
                      <Text style={[styles.createModalButtonText, { color: palette.textMuted }]}>
                        取消
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.confirmModalButton,
                        {
                          backgroundColor: localPlaylistName.trim()
                            ? palette.primary
                            : palette.border,
                        },
                      ]}
                      onPress={handleCreateLocalPlaylist}
                      disabled={creatingLocalPlaylist || !localPlaylistName.trim()}
                    >
                      {creatingLocalPlaylist ? (
                        <ActivityIndicator color={palette.primaryText} size="small" />
                      ) : (
                        <Text
                          style={[
                            styles.createModalButtonText,
                            {
                              color: localPlaylistName.trim()
                                ? palette.primaryText
                                : palette.textMuted,
                            },
                          ]}
                        >
                          {editingLocalPlaylistId ? "保存" : "创建"}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>

        <Modal
          visible={showCreateWyPlaylistModal}
          animationType="slide"
          transparent
          statusBarTranslucent
          onRequestClose={closeWyPlaylistEditor}
        >
          <View style={styles.createModalOverlay}>
            <Pressable
              style={styles.createModalBackdrop}
              onPress={closeWyPlaylistEditor}
              accessibilityRole="button"
              accessibilityLabel="关闭"
            />
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              style={styles.createModalKeyboardWrap}
            >
              <View
                style={[
                  styles.createModalCard,
                  {
                    backgroundColor: palette.surface,
                    paddingBottom: Math.max(insets.bottom, spacing.m),
                  },
                ]}
              >
                <View style={styles.sheetHandleContainer}>
                  <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
                </View>

                <View style={styles.sheetHeader}>
                  <View style={styles.titleWithIcon}>
                    <Cloud size={18} color={palette.primary} />
                    <Text style={[styles.createModalTitle, { color: palette.text }]}>
                      {editingWyPlaylistId ? "编辑网易云歌单" : "新建网易云歌单"}
                    </Text>
                  </View>
                  <Pressable
                    style={[styles.closeIconButton, { backgroundColor: palette.surfaceMuted }]}
                    onPress={closeWyPlaylistEditor}
                    accessibilityRole="button"
                    accessibilityLabel="关闭"
                  >
                    <X size={18} color={palette.textMuted} />
                  </Pressable>
                </View>

                <View style={styles.modalFormBody}>
                  <TextInput
                    value={wyPlaylistName}
                    onChangeText={setWyPlaylistName}
                    placeholder="输入歌单名称"
                    placeholderTextColor={palette.textMuted}
                    style={[
                      styles.createInput,
                      {
                        backgroundColor: palette.surfaceMuted,
                        borderColor: palette.border,
                        color: palette.text,
                      },
                    ]}
                  />
                  <TextInput
                    value={wyPlaylistDescription}
                    onChangeText={setWyPlaylistDescription}
                    placeholder="简介（可选）"
                    placeholderTextColor={palette.textMuted}
                    multiline
                    style={[
                      styles.createInput,
                      styles.createTextArea,
                      {
                        backgroundColor: palette.surfaceMuted,
                        borderColor: palette.border,
                        color: palette.text,
                      },
                    ]}
                  />
                  <View style={styles.createModalActions}>
                    <Pressable
                      style={[styles.cancelModalButton, { backgroundColor: palette.surfaceMuted }]}
                      onPress={closeWyPlaylistEditor}
                      disabled={creatingWyPlaylist}
                    >
                      <Text style={[styles.createModalButtonText, { color: palette.textMuted }]}>
                        取消
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.confirmModalButton,
                        {
                          backgroundColor: wyPlaylistName.trim()
                            ? palette.primary
                            : palette.border,
                        },
                      ]}
                      onPress={handleCreateWyPlaylist}
                      disabled={creatingWyPlaylist || !wyPlaylistName.trim()}
                    >
                      {creatingWyPlaylist ? (
                        <ActivityIndicator color={palette.primaryText} size="small" />
                      ) : (
                        <Text
                          style={[
                            styles.createModalButtonText,
                            {
                              color: wyPlaylistName.trim()
                                ? palette.primaryText
                                : palette.textMuted,
                            },
                          ]}
                        >
                          {editingWyPlaylistId ? "保存" : "创建"}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>

        <Modal
          visible={showImportLocalPlaylistModal}
          animationType="slide"
          transparent
          statusBarTranslucent
          onRequestClose={() => setShowImportLocalPlaylistModal(false)}
        >
          <View style={styles.createModalOverlay}>
            <Pressable
              style={styles.createModalBackdrop}
              onPress={() => setShowImportLocalPlaylistModal(false)}
              accessibilityRole="button"
              accessibilityLabel="关闭"
            />
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              style={styles.createModalKeyboardWrap}
            >
              <View
                style={[
                  styles.createModalCard,
                  {
                    backgroundColor: palette.surface,
                    paddingBottom: Math.max(insets.bottom, spacing.m),
                  },
                ]}
              >
                <View style={styles.sheetHandleContainer}>
                  <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
                </View>

                <View style={styles.sheetHeader}>
                  <View style={styles.titleWithIcon}>
                    <FileJson size={18} color={palette.primary} />
                    <Text style={[styles.createModalTitle, { color: palette.text }]}>
                      导入本地歌单
                    </Text>
                  </View>
                  <Pressable
                    style={[styles.closeIconButton, { backgroundColor: palette.surfaceMuted }]}
                    onPress={() => setShowImportLocalPlaylistModal(false)}
                    accessibilityRole="button"
                    accessibilityLabel="关闭"
                  >
                    <X size={18} color={palette.textMuted} />
                  </Pressable>
                </View>

                <View style={styles.modalFormBody}>
                  <TextInput
                    value={localPlaylistImportJson}
                    onChangeText={setLocalPlaylistImportJson}
                    placeholder="粘贴从 AuralFlow 导出的歌单 JSON 内容..."
                    placeholderTextColor={palette.textMuted}
                    multiline
                    style={[
                      styles.createInput,
                      styles.importTextArea,
                      {
                        backgroundColor: palette.surfaceMuted,
                        borderColor: palette.border,
                        color: palette.text,
                      },
                    ]}
                  />
                  <View style={styles.createModalActions}>
                    <Pressable
                      style={[styles.cancelModalButton, { backgroundColor: palette.surfaceMuted }]}
                      onPress={() => setShowImportLocalPlaylistModal(false)}
                      disabled={importingLocalPlaylists}
                    >
                      <Text style={[styles.createModalButtonText, { color: palette.textMuted }]}>
                        取消
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.confirmModalButton,
                        {
                          backgroundColor: localPlaylistImportJson.trim()
                            ? palette.primary
                            : palette.border,
                        },
                      ]}
                      onPress={handleImportLocalPlaylists}
                      disabled={importingLocalPlaylists || !localPlaylistImportJson.trim()}
                    >
                      {importingLocalPlaylists ? (
                        <ActivityIndicator color={palette.primaryText} size="small" />
                      ) : (
                        <Text
                          style={[
                            styles.createModalButtonText,
                            {
                              color: localPlaylistImportJson.trim()
                                ? palette.primaryText
                                : palette.textMuted,
                            },
                          ]}
                        >
                          导入
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
        <ImportPlaylistLinkModal
          visible={showImportLinkModal}
          onClose={() => setShowImportLinkModal(false)}
          palette={palette}
          onImported={(songCount, name) => {
            Alert.alert("导入成功", `已创建本地歌单「${name}」（${songCount} 首）`);
          }}
        />
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
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  createModalBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  createModalKeyboardWrap: {
    width: "100%",
    justifyContent: "flex-end",
  },
  createModalCard: {
    width: "100%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 20,
  },
  sheetHandleContainer: {
    alignItems: "center",
    paddingVertical: 10,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.s,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0, 0, 0, 0.06)",
  },
  titleWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  closeIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  modalFormBody: {
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    gap: spacing.m,
  },
  createModalTitle: {
    fontSize: typography.title,
    fontWeight: "700",
  },
  createInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.m,
    height: 44,
    fontSize: typography.body,
  },
  createTextArea: {
    height: 80,
    paddingVertical: spacing.s,
    textAlignVertical: "top",
  },
  importTextArea: {
    height: 160,
    paddingVertical: spacing.s,
    textAlignVertical: "top",
  },
  createModalActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    marginTop: spacing.xs,
  },
  cancelModalButton: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmModalButton: {
    flex: 2,
    height: 46,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  createModalButtonText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
});
