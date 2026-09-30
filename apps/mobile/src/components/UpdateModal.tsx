import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AlertCircle, ArrowRight, Download, RefreshCw, Sparkles, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { summarizeReleaseNotes } from "@lx/core";

import { Button } from "@/components/ui/Button";
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
import { logger } from "@/services/logger";
import { withAlpha } from "@/services/themePaletteModel";
import { pickApkAssetForDevice, type ApkAsset, type UpdateInfo } from "@/services/updateService";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

/**
 * 更新弹窗（底部弹层观感）。
 *
 * 设计要点，改之前先读：
 * - **只用设计令牌与 palette**：几何全部来自 `theme/tokens`，颜色全部来自主题 palette
 *   （含 `withAlpha` 派生的浅色底）。这里不硬编码字号/圆角/颜色——那是上一版最难看的根因。
 * - **强调色不做实心填充**：与 `ui/Button` 的既有约定一致（2026-08 用户要求全局退场），
 *   所以视觉重心靠版本胶囊的强调色底纹 + 进度条，而不是一个实心大按钮。
 * - **发布正文先清洗再渲染**：`summarizeReleaseNotes` 去掉 markdown 表格/分隔线/代码块，
 *   默认只显示 6 行，`展开全部` 再看完整内容。上一版把 `| 平台 | 文件 |` 直接摊在弹窗里。
 * - **触控目标 ≥ 44**：关闭键、展开、浏览器链接都补了 hitSlop（`touch.minTarget`），
 *   上一版的「取消」「打开发布页」是 12-13px 的裸文字。
 * - **安装是终态**：`installApk` 只是把 APK 交给系统安装器，返回不代表装完；
 *   因此有独立的 `handedOff` 状态，不假装"安装已完成"。
 */
interface UpdateModalProps {
  visible: boolean;
  info: UpdateInfo;
  onClose: () => void;
}

type InstallPhase = "idle" | "downloading" | "installing" | "handedOff" | "failed";

/** 默认显示多少行更新说明（其余靠「展开全部」） */
const COLLAPSED_NOTE_LINES = 6;
const EXPANDED_NOTE_LINES = 80;

/** 下载源：`mirror` = 内置加速镜像，`direct` = GitHub 直连 */
type DownloadSource = "mirror" | "direct";

/** 下载源文案：进度行后缀与失败日志共用一份，避免两处各写一套名字 */
const DOWNLOAD_SOURCE_LABEL: Record<DownloadSource, string> = {
  mirror: "加速镜像",
  direct: "直连",
};

/**
 * 依次尝试的下载源：加速镜像在前、GitHub 直连兜底。
 * 原址不是 GitHub（或改写无意义）时两个地址完全相同，去重成一个并按直连处理。
 */
function buildDownloadSources(asset: ApkAsset): { url: string; source: DownloadSource }[] {
  if (asset.url === asset.fallbackUrl) return [{ url: asset.url, source: "direct" }];
  return [
    { url: asset.url, source: "mirror" },
    { url: asset.fallbackUrl, source: "direct" },
  ];
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return "";
  const mb = bytes / 1024 / 1024;
  return `${mb >= 1024 ? (mb / 1024).toFixed(2) : mb.toFixed(1)} MB`;
}

function formatPublishedAt(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function UpdateModal({ visible, info, onClose }: UpdateModalProps) {
  const mode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const accentColor = useThemeStore((s) => s.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const insets = useSafeAreaInsets();

  const [asset, setAsset] = useState<ApkAsset | null>(null);
  const [phase, setPhase] = useState<InstallPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [activeSource, setActiveSource] = useState<DownloadSource | null>(null);
  const jobIdRef = useRef<number | null>(null);
  // 取消标志：downloadApk 在用户主动取消时静默 resolve，没有它就没法把「取消」和「下载成功」分开。
  const cancelRequestedRef = useRef(false);

  const inAppInstallAvailable = isApkInstallSupported();
  const busy = phase === "downloading" || phase === "installing";

  useEffect(() => {
    if (!visible) return;
    setPhase("idle");
    setProgress(0);
    setDownloadedBytes(0);
    setErrorMessage("");
    setNotesExpanded(false);
    if (!inAppInstallAvailable) {
      setAsset(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const picked = pickApkAssetForDevice(info.apkAssets, await getSupportedAbis());
      if (!cancelled) setAsset(picked);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, info, inAppInstallAvailable]);

  const notes = useMemo(
    () =>
      summarizeReleaseNotes(
        info.changelog,
        notesExpanded ? EXPANDED_NOTE_LINES : COLLAPSED_NOTE_LINES,
      ),
    [info.changelog, notesExpanded],
  );

  const totalBytes = asset?.size && asset.size > 0 ? asset.size : 0;
  const percent = Math.round(progress * 100);

  const releaseMeta = [
    totalBytes > 0 ? `安装包 ${formatSize(totalBytes)}` : "",
    formatPublishedAt(info.publishedAt) ? `${formatPublishedAt(info.publishedAt)} 发布` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const handleCancelDownload = () => {
    // 先立标志再停任务：downloadApk 取消时静默 resolve，这个标志是唯一的「用户取消」信号。
    cancelRequestedRef.current = true;
    cancelApkDownload(jobIdRef);
    setPhase("idle");
    setProgress(0);
    setDownloadedBytes(0);
  };

  const handleClose = () => {
    if (phase === "downloading") {
      // 关闭（含 Android 返回键）同样是取消：不置标志就会把这次取消当成「下载成功」。
      cancelRequestedRef.current = true;
      cancelApkDownload(jobIdRef);
    }
    onClose();
  };

  /** 用户取消后回到 idle 态（不安装、不换源重试）；返回是否发生了取消 */
  const abortIfCancelled = () => {
    if (!cancelRequestedRef.current) return false;
    setPhase("idle");
    return true;
  };

  const startInAppInstall = async () => {
    if (!asset) return;
    const path = getApkDownloadPath(asset.name);

    try {
      const permitted = await hasInstallPermission();
      if (!permitted) {
        // 授权是系统流程，必须跳出 App；这里保留系统弹窗提示用户回来重试。
        await openInstallPermissionSettings();
        setPhase("failed");
        setErrorMessage("需要在系统设置中允许 AuralFlow 安装应用，返回后点「重试」继续。");
        return;
      }

      if (!(await isApkDownloaded(path))) {
        // 新一轮下载：先清掉上一轮的取消标志，否则会被误当成「这一轮也取消了」。
        cancelRequestedRef.current = false;
        setPhase("downloading");
        setProgress(0);
        setDownloadedBytes(0);

        // 加速镜像优先，失败再回退 GitHub 直连；原址不是 GitHub 时两个候选会去重成一个。
        const sources = buildDownloadSources(asset);
        for (let index = 0; index < sources.length; index += 1) {
          const candidate = sources[index];
          // 上一个源失败后、切到下一个源之前：用户可能已经点了「取消下载」。
          if (abortIfCancelled()) return;
          setActiveSource(candidate.source);
          try {
            await downloadApk(candidate.url, path, jobIdRef, (p) => {
              const total = p.contentLength > 0 ? p.contentLength : totalBytes;
              setDownloadedBytes(p.bytesWritten);
              setProgress(total > 0 ? Math.min(1, p.bytesWritten / total) : 0);
            });
            // downloadApk 被取消时是静默 resolve（不抛错），只能靠标志位区分
            // 「用户取消」与「下载完成」，否则会接着去安装一个并不存在的文件。
            if (abortIfCancelled()) return;
            break;
          } catch (error) {
            if (abortIfCancelled()) return;
            // 还有备用源：记下失败源与错误，换源再试；最后一个源也失败则交给外层失败态。
            if (index === sources.length - 1) throw error;
            logger.warn(
              `更新包下载失败，改用下一个下载源重试（失败源：${DOWNLOAD_SOURCE_LABEL[candidate.source]}）`,
              error,
            );
          }
        }
      }

      setPhase("installing");
      await installApk(path);
      // 安装器已在系统侧接手：不谎称"安装完成"，也不替用户关闭弹窗。
      setPhase("handedOff");
    } catch (error) {
      setPhase("failed");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handlePrimary = () => {
    if (busy) return;
    if (asset && inAppInstallAvailable) {
      void startInAppInstall();
      return;
    }
    if (info.releaseUrl) void Linking.openURL(info.releaseUrl);
  };

  const primaryLabel =
    phase === "downloading"
      ? `下载中 ${percent}%`
      : phase === "installing"
        ? "正在打开安装器…"
        : phase === "failed"
          ? "重试"
          : phase === "handedOff"
            ? "已交给系统安装器"
            : asset
              ? `下载并安装${totalBytes > 0 ? `（${formatSize(totalBytes)}）` : ""}`
              : "打开发布页";

  const secondaryLabel = phase === "downloading" ? "取消下载" : phase === "handedOff" ? "完成" : "稍后再说";

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          // 下载中不允许点遮罩关闭：那会静默取消一个进行中的下载，必须走「取消下载」。
          onPress={busy ? undefined : handleClose}
          accessibilityRole="button"
          accessibilityLabel="关闭更新提示"
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: palette.background,
              borderColor: palette.border,
              paddingBottom: Math.max(insets.bottom, spacing.m),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View style={styles.hero}>
              <View
                style={[
                  styles.heroMark,
                  {
                    backgroundColor: withAlpha(palette.primary, 0.14),
                    borderColor: withAlpha(palette.primary, 0.28),
                  },
                ]}
              >
                <Sparkles size={20} color={palette.primary} />
              </View>
              <View style={styles.heroCopy}>
                <Text style={[styles.title, { color: palette.text }]}>发现新版本</Text>
                <Text style={[styles.subtitle, { color: palette.textMuted }]}>
                  {releaseMeta || info.releaseName || "可立即下载安装"}
                </Text>
              </View>
              <Pressable
                onPress={handleClose}
                disabled={busy}
                hitSlop={touch.minTarget - 20}
                accessibilityRole="button"
                accessibilityLabel="关闭"
                accessibilityState={{ disabled: busy }}
              >
                <X size={20} color={palette.textMuted} />
              </Pressable>
            </View>

            <View
              style={styles.versionRow}
              accessible
              accessibilityLabel={`当前版本 ${info.currentVersion}，可更新到 ${info.latestVersion}`}
            >
              <View style={[styles.chip, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <Text style={[styles.chipLabel, { color: palette.textMuted }]}>
                  当前 {info.currentVersion}
                </Text>
              </View>
              <ArrowRight size={14} color={palette.textMuted} />
              <View
                style={[
                  styles.chip,
                  {
                    backgroundColor: withAlpha(palette.primary, 0.14),
                    borderColor: withAlpha(palette.primary, 0.32),
                  },
                ]}
              >
                <Text style={[styles.chipLabel, styles.chipLabelLatest, { color: palette.primary }]}>
                  最新 {info.latestVersion}
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>更新内容</Text>
              <View
                style={[
                  styles.notesCard,
                  { backgroundColor: palette.surface, borderColor: palette.border },
                ]}
              >
                {notes.lines.length > 0 ? (
                  notes.lines.map((line, index) => (
                    // 更新说明是只读文本，行序稳定，用下标做 key 是安全的。
                    <Text key={`${index}`} style={[styles.noteLine, { color: palette.text }]}>
                      {line}
                    </Text>
                  ))
                ) : (
                  <Text style={[styles.noteLine, { color: palette.textMuted }]}>
                    本次发布未附更新说明。
                  </Text>
                )}
                {notes.truncated || notesExpanded ? (
                  <Pressable
                    onPress={() => setNotesExpanded((value) => !value)}
                    hitSlop={spacing.xs}
                    style={styles.notesToggle}
                    accessibilityRole="button"
                    accessibilityLabel={notesExpanded ? "收起更新说明" : "展开全部更新说明"}
                  >
                    <Text style={[styles.notesToggleLabel, { color: palette.primary }]}>
                      {notesExpanded ? "收起" : "展开全部"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {phase === "downloading" ? (
              <View style={styles.section} accessibilityLiveRegion="polite">
                <View style={styles.progressMeta}>
                  <Text style={[styles.progressLabel, { color: palette.text }]}>
                    正在下载安装包…{activeSource ? `（${DOWNLOAD_SOURCE_LABEL[activeSource]}）` : ""}
                  </Text>
                  <Text style={[styles.progressValue, { color: palette.textMuted }]}>
                    {totalBytes > 0
                      ? `${formatSize(downloadedBytes)} / ${formatSize(totalBytes)}`
                      : formatSize(downloadedBytes)}
                  </Text>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: palette.surface }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: palette.primary,
                        width: `${Math.max(2, Math.min(100, percent))}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            ) : null}

            {phase === "installing" || phase === "handedOff" ? (
              <View
                style={[
                  styles.notice,
                  {
                    backgroundColor: withAlpha(palette.primary, 0.10),
                    borderColor: withAlpha(palette.primary, 0.22),
                  },
                ]}
                accessibilityLiveRegion="polite"
              >
                {phase === "installing" ? (
                  <ActivityIndicator size="small" color={palette.primary} />
                ) : (
                  <Sparkles size={16} color={palette.primary} />
                )}
                <Text style={[styles.noticeText, { color: palette.text }]}>
                  {phase === "installing"
                    ? "正在打开系统安装器…"
                    : "已交给系统安装器。请按系统提示完成安装；安装完成后 AuralFlow 会重新启动。"}
                </Text>
              </View>
            ) : null}

            {phase === "failed" && errorMessage ? (
              <View
                style={[
                  styles.notice,
                  { backgroundColor: palette.dangerSurface, borderColor: palette.danger },
                ]}
                accessibilityLiveRegion="polite"
              >
                <AlertCircle size={16} color={palette.danger} />
                <Text style={[styles.noticeText, { color: palette.danger }]}>{errorMessage}</Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              {phase === "idle" && asset && asset.url !== asset.fallbackUrl ? (
                <Text style={[styles.sourceHint, { color: palette.textMuted }]}>
                  下载源：加速镜像，失败自动改用直连
                </Text>
              ) : null}
              <Button
                label={primaryLabel}
                size="large"
                variant="primary"
                loading={phase === "installing"}
                disabled={phase === "downloading" || phase === "handedOff"}
                leading={
                  phase === "failed" ? (
                    <RefreshCw size={18} color={palette.primary} />
                  ) : phase === "idle" ? (
                    <Download size={18} color={palette.primary} />
                  ) : undefined
                }
                onPress={handlePrimary}
                style={styles.primaryButton}
              />
              <Button
                label={secondaryLabel}
                size="medium"
                variant="ghost"
                onPress={phase === "downloading" ? handleCancelDownload : handleClose}
              />
              {phase === "idle" && info.releaseUrl ? (
                <Pressable
                  onPress={() => void Linking.openURL(info.releaseUrl)}
                  style={styles.releaseLink}
                  accessibilityRole="link"
                  accessibilityLabel="在浏览器中打开发布页"
                >
                  <Text style={[styles.releaseLinkLabel, { color: palette.textMuted }]}>
                    在浏览器中打开发布页
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
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
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: "88%",
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    marginTop: spacing.xs,
  },
  body: {
    paddingHorizontal: spacing.l,
    paddingTop: spacing.m,
    gap: spacing.l,
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  heroMark: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: { flex: 1, minWidth: 0, gap: spacing.xxs / 2 },
  title: { fontSize: typography.heading, fontWeight: "700" },
  subtitle: { fontSize: typography.caption, lineHeight: 16 },
  versionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xxs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipLabel: { fontSize: typography.meta, fontWeight: "600" },
  chipLabelLatest: { fontWeight: "700" },
  section: { gap: spacing.xs },
  sectionLabel: { fontSize: typography.caption, fontWeight: "600", letterSpacing: 0.4 },
  notesCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.s,
    gap: spacing.xs,
  },
  noteLine: { fontSize: typography.meta, lineHeight: 20 },
  notesToggle: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xxs,
    minHeight: spacing.l,
    justifyContent: "center",
  },
  notesToggleLabel: { fontSize: typography.meta, fontWeight: "700" },
  progressMeta: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  progressLabel: { fontSize: typography.meta, fontWeight: "600" },
  progressValue: { fontSize: typography.caption, fontVariant: ["tabular-nums"] },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: radius.pill },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.s,
  },
  noticeText: { flex: 1, fontSize: typography.meta, lineHeight: 20 },
  actions: { gap: spacing.xs, alignItems: "stretch" },
  primaryButton: { alignSelf: "stretch" },
  sourceHint: { fontSize: typography.caption, lineHeight: 16, textAlign: "center" },
  releaseLink: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: touch.minTarget,
  },
  releaseLinkLabel: { fontSize: typography.caption, textDecorationLine: "underline" },
});
