import React, { useEffect, useRef, useState } from "react";
import { Alert, Linking, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import { ActionButton } from "@/components/ActionButton";
import {
  cancelApkDownload,
  downloadApk,
  getApkDownloadPath,
  getSupportedAbis,
  hasInstallPermission,
  installApk,
  isApkDownloaded,
  isApkInstallSupported,
  openInstallPermissionSettings,
} from "@/services/apkInstallService";
import { pickApkAssetForDevice, type ApkAsset, type UpdateInfo } from "@/services/updateService";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

interface UpdateModalProps {
  visible: boolean;
  info: UpdateInfo;
  onClose: () => void;
}

type InstallPhase = "idle" | "downloading" | "installing";

function formatSize(bytes: number): string {
  if (bytes <= 0) return "";
  const mb = bytes / 1024 / 1024;
  return `${mb >= 1024 ? (mb / 1024).toFixed(2) : mb.toFixed(1)} MB`;
}

export function UpdateModal({ visible, info, onClose }: UpdateModalProps) {
  const mode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const accentColor = useThemeStore((s) => s.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const [asset, setAsset] = useState<ApkAsset | null>(null);
  const [phase, setPhase] = useState<InstallPhase>("idle");
  const [progress, setProgress] = useState(0);
  const jobIdRef = useRef<number | null>(null);

  const inAppInstallAvailable = isApkInstallSupported();

  useEffect(() => {
    if (!visible || !inAppInstallAvailable) return;
    let cancelled = false;
    setPhase("idle");
    setProgress(0);
    void (async () => {
      const picked = pickApkAssetForDevice(info.apkAssets, await getSupportedAbis());
      if (!cancelled) setAsset(picked);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, info, inAppInstallAvailable]);

  const handleCancelDownload = () => {
    cancelApkDownload(jobIdRef);
    setPhase("idle");
    setProgress(0);
  };

  const startInAppInstall = async () => {
    if (!asset) return;
    const path = getApkDownloadPath(asset.name);

    try {
      const permitted = await hasInstallPermission();
      if (!permitted) {
        await openInstallPermissionSettings();
        Alert.alert(
          "需要安装权限",
          "请在系统设置中允许 AuralFlow 安装应用，返回后再次点击「下载并安装」。",
        );
        return;
      }

      if (!(await isApkDownloaded(path))) {
        setPhase("downloading");
        setProgress(0);
        await downloadApk(asset.url, path, jobIdRef, (p) => {
          const total = p.contentLength > 0 ? p.contentLength : asset.size;
          setProgress(total > 0 ? Math.min(1, p.bytesWritten / total) : 0);
        });
      }

      setPhase("installing");
      await installApk(path);
      // 已交给系统安装器，用户可能留在安装页；弹窗保持打开由用户关闭
      setPhase("idle");
    } catch (error) {
      setPhase("idle");
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert("更新失败", message, [
        { text: "取消", style: "cancel" },
        {
          text: "打开发布页",
          onPress: () => {
            if (info.releaseUrl) void Linking.openURL(info.releaseUrl);
          },
        },
      ]);
    }
  };

  const handleClose = () => {
    if (phase === "downloading") cancelApkDownload(jobIdRef);
    onClose();
  };

  const primaryLabel =
    phase === "downloading"
      ? `${Math.round(progress * 100)}%`
      : phase === "installing"
        ? "正在安装…"
        : asset
          ? `下载并安装${asset.size > 0 ? `（${formatSize(asset.size)}）` : ""}`
          : "打开发布页";

  const handlePrimary = () => {
    if (phase === "downloading") return;
    if (asset && inAppInstallAvailable) void startInAppInstall();
    else if (info.releaseUrl) void Linking.openURL(info.releaseUrl);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: palette.surface }]}>
          <Text style={[styles.title, { color: palette.text }]}>发现新版本</Text>
          <View
            style={styles.versionRow}
            accessible
            accessibilityLabel={`当前版本 ${info.currentVersion}，最新版本 ${info.latestVersion}`}
          >
            <Text style={[styles.version, { color: palette.primary }]}>当前 {info.currentVersion}</Text>
            <ChevronRight size={16} color={palette.primary} />
            <Text style={[styles.version, { color: palette.primary }]}>最新 {info.latestVersion}</Text>
          </View>
          <Text style={[styles.releaseName, { color: palette.text }]}>{info.releaseName}</Text>
          <ScrollView style={styles.changelogScroll}>
            <Text style={[styles.changelog, { color: palette.textMuted }]}>
              {info.changelog || "暂无更新日志"}
            </Text>
          </ScrollView>
          {phase === "downloading" ? (
            <View style={styles.progressRow}>
              <View style={[styles.progressTrack, { backgroundColor: palette.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    { backgroundColor: palette.primary, width: `${Math.max(3, Math.round(progress * 100))}%` },
                  ]}
                />
              </View>
              <Text style={[styles.progressCancel, { color: palette.textMuted }]} onPress={handleCancelDownload}>
                取消
              </Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            <ActionButton small label="稍后" onPress={handleClose} />
            <ActionButton
              small
              variant="primary"
              label={primaryLabel}
              disabled={phase === "downloading"}
              loading={phase === "installing"}
              onPress={handlePrimary}
            />
          </View>
          {asset && info.releaseUrl ? (
            <Text
              style={[styles.releaseLink, { color: palette.textMuted }]}
              onPress={() => void Linking.openURL(info.releaseUrl)}
            >
              或在浏览器中打开发布页
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 14,
    padding: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  versionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 6,
  },
  version: {
    fontSize: 15,
    fontWeight: "600",
  },
  releaseName: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
  },
  changelogScroll: {
    maxHeight: 200,
    marginBottom: 16,
  },
  changelog: {
    fontSize: 13,
    lineHeight: 20,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  progressCancel: {
    fontSize: 13,
    paddingVertical: 4,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "flex-end",
  },
  releaseLink: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 12,
    textDecorationLine: "underline",
  },
});
