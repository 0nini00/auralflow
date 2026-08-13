import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronRight, Music2 } from "lucide-react-native";

import { CachedImage } from "@/components/CachedImage";
import { getBiliCollectionVisibilityModel } from "@/services/biliCollectionVisibilityModel";
import type { BiliCollectionInfo } from "@/services/biliService";
import { useBiliAccountStore } from "@/stores/biliAccountStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

interface BiliCollectionListProps {
  onCollectionPress: (collection: BiliCollectionInfo) => void;
}

export function BiliCollectionList({ onCollectionPress }: BiliCollectionListProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const biliAccount = useBiliAccountStore((state) => state.account);
  const biliPlaylists = useBiliAccountStore((state) => state.playlists);
  const hiddenCollectionIds = useBiliAccountStore((state) => state.hiddenCollectionIds);
  const newCollectionIds = useBiliAccountStore((state) => state.newCollectionIds);
  const autoShowNewCollections = useBiliAccountStore((state) => state.autoShowNewCollections);
  const biliIsLoaded = useBiliAccountStore((state) => state.isLoaded);
  const biliIsLoading = useBiliAccountStore((state) => state.isLoading);
  const biliError = useBiliAccountStore((state) => state.error);
  const biliLoad = useBiliAccountStore((state) => state.load);
  const setCollectionVisible = useBiliAccountStore((state) => state.setCollectionVisible);
  const setAutoShowNewCollections = useBiliAccountStore((state) => state.setAutoShowNewCollections);
  const clearNewCollectionState = useBiliAccountStore((state) => state.clearNewCollectionState);
  const [showManager, setShowManager] = useState(false);

  const visibility = getBiliCollectionVisibilityModel({
    collections: biliPlaylists,
    hiddenCollectionIds,
    newCollectionIds,
    autoShowNewCollections,
  });
  const hiddenIdSet = new Set(hiddenCollectionIds);
  const newIdSet = new Set(newCollectionIds);

  const openManager = () => {
    setShowManager(true);
  };

  const closeManager = () => {
    clearNewCollectionState();
    setShowManager(false);
  };

  if (!biliAccount) {
    // 收敛方案：B站登录/退出只保留在「设置 → 账号与服务」，这里仅显示纯状态文字。
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: palette.textMuted }]}>
          {biliIsLoaded ? "未登录 B站" : "加载中…"}
        </Text>
        <Text style={[styles.emptyHint, { color: palette.textMuted }]}>
          请在 设置 → 账号与服务 登录 B站账号
        </Text>
      </View>
    );
  }

  if (biliIsLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={palette.primary} size="large" />
        <Text style={[styles.loadingText, { color: palette.textMuted }]}>加载合集…</Text>
      </View>
    );
  }

  if (biliError) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.errorText, { color: palette.danger }]}>{biliError}</Text>
        <Pressable
          style={[styles.scanButton, { backgroundColor: palette.surface, marginTop: 12 }]}
          onPress={() => biliLoad()}
        >
          <Text style={[styles.scanButtonText, { color: palette.primary }]}>重试</Text>
        </Pressable>
      </View>
    );
  }

  if (biliPlaylists.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: palette.textMuted }]}>暂无可见合集</Text>
      </View>
    );
  }

  return (
    <View style={styles.collectionList}>
      <View style={styles.managerHeader}>
        <View>
          <Text style={[styles.managerTitle, { color: palette.text }]}>B站合集</Text>
          <Text style={[styles.collectionMeta, { color: palette.textMuted }]}>显示 {visibility.visibleCollections.length}/{visibility.totalCount}</Text>
        </View>
        <View style={styles.managerActions}>
          {visibility.hasNewCollections ? (
            <Pressable
              style={[styles.newBadge, { backgroundColor: palette.primary }]}
              onPress={openManager}
            >
              <Text style={[styles.newBadgeText, { color: palette.primaryText }]}>新发现 {visibility.newCount}</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.scanButton, { backgroundColor: palette.surface }]}
            onPress={openManager}
          >
            <Text style={[styles.scanButtonText, { color: palette.primary }]}>管理</Text>
          </Pressable>
        </View>
      </View>

      {visibility.visibleCollections.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: palette.textMuted }]}>{visibility.emptyText}</Text>
          <Pressable
            style={[styles.scanButton, { backgroundColor: palette.surface, marginTop: 12 }]}
            onPress={openManager}
          >
            <Text style={[styles.scanButtonText, { color: palette.primary }]}>管理合集</Text>
          </Pressable>
        </View>
      ) : visibility.visibleCollections.map((collection) => (
        <Pressable
          key={collection.id}
          style={[styles.collectionItem, { backgroundColor: palette.surface }]}
          onPress={() => onCollectionPress(collection)}
        >
          <CachedImage
            uri={collection.picUrl || ""}
            fallback={
              <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surfaceMuted }]}>
                <Music2 size={22} color={palette.primary} />
              </View>
            }
            style={styles.cover}
          />
          <View style={styles.collectionInfo}>
            <Text style={[styles.collectionName, { color: palette.text }]} numberOfLines={1}>
              {collection.name}
            </Text>
            <Text style={[styles.collectionMeta, { color: palette.textMuted }]} numberOfLines={1}>
              {collection.author || "B站"} · {collection.trackCount ?? collection.mediaCount ?? 0} 个内容
            </Text>
          </View>
          <ChevronRight size={20} color={palette.textMuted} />
        </Pressable>
      ))}
      <Modal visible={showManager} animationType="slide" onRequestClose={closeManager}>
        <ScrollView contentContainerStyle={[styles.managerModal, { backgroundColor: palette.background }]}>
          <View style={styles.managerModalHeader}>
            <View>
              <Text style={[styles.managerTitle, { color: palette.text }]}>B站合集管理</Text>
              <Text style={[styles.collectionMeta, { color: palette.textMuted }]}>选择哪些收藏合集显示在列表里</Text>
            </View>
            <Pressable onPress={closeManager}>
              <Text style={[styles.closeText, { color: palette.primary }]}>关闭</Text>
            </Pressable>
          </View>

          <Pressable
            style={[styles.autoShowRow, { backgroundColor: palette.surface }]}
            onPress={() => setAutoShowNewCollections(!visibility.autoShowNewCollections)}
          >
            <View style={styles.collectionInfo}>
              <Text style={[styles.collectionName, { color: palette.text }]}>新合集自动显示</Text>
              <Text style={[styles.collectionMeta, { color: palette.textMuted }]}>关闭后，新收藏的合集会先进入管理列表</Text>
            </View>
            <Text style={[styles.toggleText, { color: visibility.autoShowNewCollections ? palette.primary : palette.textMuted }]}>
              {visibility.autoShowNewCollections ? "开启" : "关闭"}
            </Text>
          </Pressable>

          {biliPlaylists.map((collection) => {
            const visible = !hiddenIdSet.has(collection.id);
            const isNew = newIdSet.has(collection.id);
            return (
              <Pressable
                key={collection.id}
                style={[styles.managerItem, { backgroundColor: palette.surface }]}
                onPress={() => setCollectionVisible(collection.id, !visible)}
              >
                <CachedImage
                  uri={collection.picUrl || ""}
                  fallback={
                    <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surfaceMuted }]}>
                      <Music2 size={22} color={palette.primary} />
                    </View>
                  }
                  style={styles.cover}
                />
                <View style={styles.collectionInfo}>
                  <View style={styles.managerNameRow}>
                    <Text style={[styles.collectionName, { color: palette.text }]} numberOfLines={1}>
                      {collection.name}
                    </Text>
                    {isNew ? <Text style={[styles.inlineNewBadge, { color: palette.primary }]}>新发现</Text> : null}
                  </View>
                  <Text style={[styles.collectionMeta, { color: palette.textMuted }]} numberOfLines={1}>
                    {collection.author || "B站"} · {collection.trackCount ?? collection.mediaCount ?? 0} 个内容
                  </Text>
                </View>
                <Text style={[styles.toggleText, { color: visible ? palette.primary : palette.textMuted }]}>
                  {visible ? "显示" : "隐藏"}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyContainer: {
    padding: spacing.l,
    alignItems: "center",
    gap: spacing.xs,
  },
  emptyText: {
    fontSize: typography.body,
  },
  emptyHint: {
    fontSize: typography.caption,
    textAlign: "center",
  },
  errorText: {
    fontSize: typography.body,
    textAlign: "center",
  },
  loadingContainer: {
    padding: spacing.l,
    alignItems: "center",
  },
  loadingText: {
    marginTop: spacing.s,
    fontSize: typography.body,
  },
  scanButton: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
  },
  scanButtonText: {
    fontSize: typography.meta,
    fontWeight: "600",
  },
  collectionList: {
    gap: spacing.xs,
  },
  managerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s,
    marginBottom: spacing.xxs,
  },
  managerTitle: {
    fontSize: typography.title,
    fontWeight: "700",
  },
  managerActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: spacing.xs,
  },
  newBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xs,
    paddingVertical: 7,
  },
  newBadgeText: {
    fontSize: typography.caption,
    fontWeight: "700",
  },
  collectionItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.sm,
    padding: spacing.s,
    gap: spacing.s,
  },
  cover: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
  },
  coverFallback: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  collectionInfo: {
    flex: 1,
    gap: spacing.xxs,
  },
  collectionName: {
    fontSize: typography.title,
    fontWeight: "600",
  },
  collectionMeta: {
    fontSize: typography.caption,
  },
  managerModal: {
    padding: spacing.l,
    paddingBottom: 100,
    gap: spacing.xs,
  },
  managerModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.s,
    marginBottom: spacing.xs,
  },
  closeText: {
    fontSize: typography.title,
    fontWeight: "600",
  },
  autoShowRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.sm,
    padding: spacing.s,
    gap: spacing.s,
  },
  managerItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.sm,
    padding: spacing.s,
    gap: spacing.s,
  },
  managerNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  inlineNewBadge: {
    fontSize: typography.caption,
    fontWeight: "700",
  },
  toggleText: {
    fontSize: typography.meta,
    fontWeight: "700",
  },
});
