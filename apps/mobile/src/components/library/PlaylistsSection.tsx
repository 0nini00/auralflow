import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Cloud, FileJson, FolderPlus, Music2, Plus, X } from "lucide-react-native";

import { ActionButton } from "@/components/ActionButton";
import { CachedImage } from "@/components/CachedImage";
import { ImportPlaylistLinkModal } from "@/components/ImportPlaylistLinkModal";
import { SectionHeader } from "@/components/SectionHeader";
import { Touchable } from "@/components/Touchable";
import {
  openLocalPlaylistDetailScreen,
  openPlaylistDetailScreen,
} from "@/navigation/navigationRef";
import { buildWyPlaylistGroups } from "@/services/libraryPlaylistGroups";
import {
  getLocalPlaylistTrackCount,
  resolveLocalPlaylistCover,
  type LocalPlaylist,
} from "@/services/localPlaylistModel";
import {
  importPlaylistsFromJsonInput,
  shareExportedPlaylists,
} from "@/services/playlistTransferService";
import { useAccountStore } from "@/stores/accountStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

type Palette = ReturnType<typeof getThemePalette>;

/**
 * 音乐库 · 歌单段。
 *
 * 从「我的」迁入：本地歌单 + 网易云自建/收藏歌单 + 新建/导入/导出/链接导入。
 * 版式改为双列封面卡，管理动作留在段头，不再把歌单和账号混在一屏。
 */
export function PlaylistsSection() {
  const insets = useSafeAreaInsets();
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const user = useAccountStore((state) => state.user);

  const playlists = usePlaylistStore((state) => state.playlists);
  const playlistsLoading = usePlaylistStore((state) => state.loading);
  const playlistsError = usePlaylistStore((state) => state.error);
  const localPlaylists = usePlaylistStore((state) => state.localPlaylists);
  const fetchPlaylists = usePlaylistStore((state) => state.fetchPlaylists);
  const loadLocalPlaylists = usePlaylistStore((state) => state.loadLocalPlaylists);
  const createLocalPlaylist = usePlaylistStore((state) => state.createLocalPlaylist);
  const updateLocalPlaylistInfo = usePlaylistStore((state) => state.updateLocalPlaylistInfo);
  const updateWyPlaylistInfo = usePlaylistStore((state) => state.updateWyPlaylistInfo);
  const createWyPlaylist = usePlaylistStore((state) => state.createWyPlaylist);

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

  const [showCreateWyPlaylistModal, setShowCreateWyPlaylistModal] = useState(false);
  const [editingWyPlaylistId, setEditingWyPlaylistId] = useState<string | null>(null);
  const [wyPlaylistName, setWyPlaylistName] = useState("");
  const [wyPlaylistDescription, setWyPlaylistDescription] = useState("");
  const [creatingWyPlaylist, setCreatingWyPlaylist] = useState(false);
  const [wyRefreshing, setWyRefreshing] = useState(false);

  useEffect(() => {
    void loadLocalPlaylists();
  }, [loadLocalPlaylists]);

  useEffect(() => {
    if (isLoggedIn && user) {
      void fetchPlaylists(user.userId);
    }
  }, [isLoggedIn, user, fetchPlaylists]);

  const wyLikedPlaylistId = useMemo(
    () => playlists.find((playlist) => playlist.source === "wy" && playlist.name === "我喜欢的音乐")?.id,
    [playlists],
  );
  const wyPlaylistGroups = useMemo(
    () => buildWyPlaylistGroups(playlists, user?.userId, wyLikedPlaylistId),
    [playlists, user?.userId, wyLikedPlaylistId],
  );

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
    <View>
      <SectionHeader
        title="我的歌单"
        description={`${localPlaylists.length} 个`}
        action={(
          <View style={styles.headerActions}>
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

      <View style={styles.grid}>
        {localPlaylists.map((playlist) => (
          <PlaylistCard
            key={playlist.id}
            palette={palette}
            name={playlist.name}
            meta={`${getLocalPlaylistTrackCount(playlist)} 首`}
            coverUri={resolveLocalPlaylistCover(playlist)}
            onPress={() => handleLocalPlaylistPress(playlist)}
          />
        ))}
        <NewPlaylistCard palette={palette} onPress={() => openLocalPlaylistEditor()} />
      </View>

      {isLoggedIn && playlistsLoading && playlists.length === 0 ? (
        <View style={styles.cloudStatus}>
          <ActivityIndicator size="small" color={palette.primaryInk} />
          <Text style={[styles.cloudStatusText, { color: palette.textMuted }]}>正在加载网易云歌单…</Text>
        </View>
      ) : isLoggedIn && playlistsError && playlists.length === 0 ? (
        <View style={styles.cloudStatus}>
          <Text style={[styles.cloudStatusText, { color: palette.danger }]} numberOfLines={2}>
            {playlistsError}
          </Text>
          <ActionButton small label="重试" onPress={handleRefreshWyPlaylists} accessibilityLabel="重试加载网易云歌单" />
        </View>
      ) : isLoggedIn
        ? wyPlaylistGroups.map((group) => (
            <View key={group.key} style={styles.group}>
              <SectionHeader
                title={group.title}
                description={`${group.count} 个`}
                action={group.key === "owned" ? (
                  <View style={styles.headerActions}>
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
              {group.playlists.length > 0 ? (
                <View style={styles.grid}>
                  {group.playlists.map((playlist) => (
                    <PlaylistCard
                      key={playlist.id}
                      palette={palette}
                      name={playlist.name}
                      meta={`${playlist.trackCount} 首`}
                      coverUri={playlist.coverImgUrl || playlist.picUrl}
                      onPress={() => openPlaylistDetailScreen(playlist)}
                    />
                  ))}
                </View>
              ) : (
                <Text style={[styles.emptyText, { color: palette.textMuted }]}>{group.emptyText}</Text>
              )}
            </View>
          ))
        : null}

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
                  <FolderPlus size={18} color={palette.primaryInk} />
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
                    <Text style={[styles.createModalButtonText, { color: palette.textMuted }]}>取消</Text>
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
                  <Cloud size={18} color={palette.primaryInk} />
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
                    <Text style={[styles.createModalButtonText, { color: palette.textMuted }]}>取消</Text>
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
                  <FileJson size={18} color={palette.primaryInk} />
                  <Text style={[styles.createModalTitle, { color: palette.text }]}>导入本地歌单</Text>
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
                    <Text style={[styles.createModalButtonText, { color: palette.textMuted }]}>取消</Text>
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
    </View>
  );
}

function PlaylistCard({
  palette,
  name,
  meta,
  coverUri,
  onPress,
}: {
  palette: Palette;
  name: string;
  meta: string;
  coverUri?: string;
  onPress: () => void;
}) {
  return (
    <Touchable
      onPress={onPress}
      activeScale={0.97}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={styles.card}
    >
      <View style={[styles.coverWrap, { backgroundColor: palette.surfaceStrong }]}>
        {coverUri ? (
          <CachedImage
            uri={coverUri}
            style={styles.cover}
            fallback={(
              <View style={styles.coverFallback}>
                <Music2 size={22} color={palette.textSubtle} />
              </View>
            )}
          />
        ) : (
          <View style={styles.coverFallback}>
            <Music2 size={22} color={palette.textSubtle} />
          </View>
        )}
      </View>
      <Text style={[styles.cardName, { color: palette.text }]} numberOfLines={2}>
        {name}
      </Text>
      <Text style={[styles.cardMeta, { color: palette.textMuted }]} numberOfLines={1}>
        {meta}
      </Text>
    </Touchable>
  );
}

function NewPlaylistCard({ palette, onPress }: { palette: Palette; onPress: () => void }) {
  return (
    <Touchable
      onPress={onPress}
      activeScale={0.97}
      accessibilityRole="button"
      accessibilityLabel="新建歌单"
      style={styles.card}
    >
      <View style={[styles.coverWrap, styles.newCover, { borderColor: palette.border }]}>
        <Plus size={24} color={palette.textSubtle} />
      </View>
      <Text style={[styles.cardName, { color: palette.text }]}>新建歌单</Text>
      <Text style={[styles.cardMeta, { color: palette.textMuted }]}>从空白开始整理</Text>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: spacing.xs,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing.m,
    marginTop: spacing.s,
  },
  card: {
    width: "48%",
    minWidth: 0,
  },
  coverWrap: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  cover: {
    width: "100%",
    height: "100%",
  },
  coverFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  newCover: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  cardName: {
    marginTop: spacing.xs,
    fontSize: typography.body,
    lineHeight: 20,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  cardMeta: {
    marginTop: 2,
    fontSize: typography.micro,
    lineHeight: 14,
  },
  group: {
    marginTop: spacing.xl,
  },
  emptyText: {
    marginTop: spacing.s,
    fontSize: typography.meta,
  },
  cloudStatus: {
    marginTop: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  cloudStatusText: {
    flex: 1,
    fontSize: typography.meta,
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
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
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
