import React, { useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ChevronRight, Music2 } from "lucide-react-native";

import { CachedImage } from "@/components/CachedImage";
import { useBiliAccountStore } from "@/stores/biliAccountStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import type { BiliCollectionInfo } from "@/services/biliService";
import { getBiliCollectionVisibilityModel } from "@/services/biliCollectionVisibilityModel";

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
  const biliLogout = useBiliAccountStore((state) => state.logout);
  const setCollectionVisible = useBiliAccountStore((state) => state.setCollectionVisible);
  const setAutoShowNewCollections = useBiliAccountStore((state) => state.setAutoShowNewCollections);
  const clearNewCollectionState = useBiliAccountStore((state) => state.clearNewCollectionState);
  const [cookieInput, setCookieInput] = useState("");
  const [showCookieInput, setShowCookieInput] = useState(false);
  const [showManager, setShowManager] = useState(false);

  const visibility = getBiliCollectionVisibilityModel({
    collections: biliPlaylists,
    hiddenCollectionIds,
    newCollectionIds,
    autoShowNewCollections,
  });
  const hiddenIdSet = new Set(hiddenCollectionIds);
  const newIdSet = new Set(newCollectionIds);

  const handleLogin = async () => {
    if (!cookieInput.trim()) return;
    const { saveBiliCookie } = await import("@/services/biliService");
    await saveBiliCookie(cookieInput.trim());
    await biliLoad(cookieInput.trim());
    setCookieInput("");
    setShowCookieInput(false);
  };

  const handleLogout = () => {
    Alert.alert("确认退出", "确定要退出 B站账号吗？", [
      { text: "取消", style: "cancel" },
      { text: "退出", style: "destructive", onPress: () => biliLogout() },
    ]);
  };

  const openManager = () => {
    setShowManager(true);
  };

  const closeManager = () => {
    clearNewCollectionState();
    setShowManager(false);
  };

  if (!biliAccount) {
    return (
      <View style={styles.emptyContainer}>
        {showCookieInput ? (
          <>
            <Text style={[styles.emptyText, { color: palette.text }]}>粘贴 B站 Cookie</Text>
            <TextInput
              style={[styles.webdavInput, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
              placeholder="在此粘贴 Cookie..."
              placeholderTextColor={palette.textMuted}
              value={cookieInput}
              onChangeText={setCookieInput}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            <View style={styles.webdavButtonRow}>
              <Pressable
                style={[styles.webdavButton, { borderColor: palette.border, backgroundColor: palette.surface }]}
                onPress={() => setShowCookieInput(false)}
              >
                <Text style={[styles.webdavButtonText, { color: palette.textMuted }]}>取消</Text>
              </Pressable>
              <Pressable
                style={[styles.webdavButton, { borderColor: palette.primary, backgroundColor: palette.primary }]}
                onPress={handleLogin}
              >
                <Text style={[styles.webdavButtonText, { color: palette.primaryText }]}>登录</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.emptyText, { color: palette.textMuted }]}> 
              {biliIsLoaded ? "未登录 B站" : "加载中..."}
            </Text>
            <Pressable
              style={[styles.scanButton, { backgroundColor: palette.primary, marginTop: 12 }]}
              onPress={() => setShowCookieInput(true)}
            >
              <Text style={[styles.scanButtonText, { color: palette.primaryText }]}>登录 B站</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  if (biliIsLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={palette.primary} size="large" />
        <Text style={[styles.loadingText, { color: palette.textMuted }]}>加载合集...</Text>
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
        <Pressable
          style={[styles.scanButton, { backgroundColor: palette.dangerSurface, marginTop: 12 }]}
          onPress={handleLogout}
        >
          <Text style={[styles.scanButtonText, { color: palette.danger }]}>退出登录</Text>
        </Pressable>
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
      <Pressable
        style={[styles.scanButton, { backgroundColor: palette.dangerSurface, marginTop: 12, alignSelf: "center" }]}
        onPress={handleLogout}
      >
        <Text style={[styles.scanButtonText, { color: palette.danger }]}>退出 B站登录</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyContainer: {
    padding: 24,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    color: "#8fa79f",
  },
  errorText: {
    fontSize: 14,
    color: "#ff6b6b",
    textAlign: "center",
  },
  loadingContainer: {
    padding: 24,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#8fa79f",
  },
  scanButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  scanButtonText: {
    fontSize: 12,
    fontWeight: "600",
  },
  webdavInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    minHeight: 96,
    width: "100%",
    marginTop: 12,
  },
  webdavButtonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
  },
  webdavButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  webdavButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
  collectionList: {
    gap: 10,
  },
  managerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 4,
  },
  managerTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  managerActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 8,
  },
  newBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  newBadgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  collectionItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a3a31",
    borderRadius: 8,
    padding: 12,
    gap: 12,
  },
  cover: {
    width: 48,
    height: 48,
    borderRadius: 6,
  },
  coverFallback: {
    width: 48,
    height: 48,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  collectionInfo: {
    flex: 1,
    gap: 4,
  },
  collectionName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  collectionMeta: {
    fontSize: 12,
    color: "#8fa79f",
  },
  managerModal: {
    padding: 20,
    paddingBottom: 100,
    gap: 10,
  },
  managerModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 8,
  },
  closeText: {
    fontSize: 15,
    fontWeight: "600",
  },
  autoShowRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    padding: 12,
    gap: 12,
  },
  managerItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    padding: 12,
    gap: 12,
  },
  managerNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inlineNewBadge: {
    fontSize: 11,
    fontWeight: "700",
  },
  toggleText: {
    fontSize: 13,
    fontWeight: "700",
  },
});
