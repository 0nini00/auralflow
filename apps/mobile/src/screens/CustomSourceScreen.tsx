import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Modal,
  Switch,
  Alert,
  Linking,
} from "react-native";
import { ActionButton } from "@/components/ActionButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Code2 } from "lucide-react-native";

import { EmptyState } from "@/components/ScreenState";
import {
  useCustomSourceStore,
  type CustomSourceItem,
} from "@/stores/customSourceStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { pickCustomSourceScriptFile } from "@/services/customSourceFilePicker";
import { radius, spacing, touch, typography } from "@/theme/tokens";

function openCustomSourceUpdateUrl(updateUrl?: string) {
  if (!updateUrl) return;
  void Linking.openURL(updateUrl);
}

export function CustomSourceScreen() {
  const sources = useCustomSourceStore((state) => state.sources);
  const loaded = useCustomSourceStore((state) => state.loaded);
  const loadFromStorage = useCustomSourceStore((state) => state.loadFromStorage);
  const importScript = useCustomSourceStore((state) => state.importScript);
  const importFromFile = useCustomSourceStore((state) => state.importFromFile);
  const removeSource = useCustomSourceStore((state) => state.removeSource);
  const toggleSource = useCustomSourceStore((state) => state.toggleSource);
  const moveSource = useCustomSourceStore((state) => state.moveSource);
  const testSource = useCustomSourceStore((state) => state.testSource);
  const checkSourceUpdate = useCustomSourceStore((state) => state.checkSourceUpdate);
  const checkAllUpdates = useCustomSourceStore((state) => state.checkAllUpdates);
  const toggleUpdateAlert = useCustomSourceStore((state) => state.toggleUpdateAlert);
  const customSourceAutoCheck = useCustomSourceStore((state) => state.customSourceAutoCheck);
  const setCustomSourceAutoCheck = useCustomSourceStore((state) => state.setCustomSourceAutoCheck);

  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const [importModalVisible, setImportModalVisible] = useState(false);
  const [scriptInput, setScriptInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [importingFile, setImportingFile] = useState(false);

  useEffect(() => {
    if (!loaded) {
      void loadFromStorage();
    }
  }, [loaded, loadFromStorage]);

  const handleImport = async () => {
    const script = scriptInput.trim();
    if (!script) {
      Alert.alert("提示", "请粘贴自定义音源脚本文本");
      return;
    }
    setImporting(true);
    try {
      const item = await importScript(script);
      setImportModalVisible(false);
      setScriptInput("");
      Alert.alert("导入成功", `已导入音源「${item.name}」`);
    } catch (error) {
      Alert.alert(
        "导入失败",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setImporting(false);
    }
  };

  const handleImportFromFile = async () => {
    if (importingFile) return;
    setImportingFile(true);
    try {
      const filePath = await pickCustomSourceScriptFile();
      if (!filePath) return;
      const item = await importFromFile(filePath);
      if (item) {
        Alert.alert("导入成功", `已导入音源「${item.name}」`);
      }
    } catch (error) {
      Alert.alert("导入失败", error instanceof Error ? error.message : String(error));
    } finally {
      setImportingFile(false);
    }
  };

  const handleRemove = (source: CustomSourceItem) => {
    Alert.alert("删除音源", `确定删除「${source.name}」吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => removeSource(source.id),
      },
    ]);
  };

  const handleCheckAll = () => {
    if (sources.length === 0) return;
    void checkAllUpdates();
  };

  return (
    <View style={styles.inlineContent}>
      <View style={styles.headerActions}>
        <ActionButton
          small
          label="从文件导入"
          loading={importingFile}
          onPress={() => void handleImportFromFile()}
          accessibilityLabel="从文件导入自定义音源"
        />
        <ActionButton
          small
          variant="primary"
          label="粘贴导入"
          onPress={() => setImportModalVisible(true)}
          accessibilityLabel="粘贴导入自定义音源"
        />
      </View>

      {/* 操作栏 */}
      {sources.length > 0 && (
        <View style={styles.actionBar}>
          <ActionButton
            small
            label="检测全部更新"
            onPress={handleCheckAll}
            accessibilityLabel="检测全部音源更新"
          />
        </View>
      )}

      <SettingsCard style={styles.autoCheckCard}>
        <View style={styles.autoCheckRow}>
          <View style={styles.autoCheckTextWrap}>
            <Text style={[styles.autoCheckTitle, { color: palette.text }]}>启动自动检测更新</Text>
            <Text style={[styles.autoCheckSubtitle, { color: palette.textMuted }]}>打开应用后自动检测已导入音源的新版本</Text>
          </View>
          <Switch
            value={customSourceAutoCheck}
            onValueChange={(enabled) => void setCustomSourceAutoCheck(enabled)}
            accessibilityRole="switch"
            accessibilityLabel="启动自定义音源自动检测更新"
            accessibilityState={{ checked: customSourceAutoCheck, disabled: false }}
            trackColor={{ false: palette.surfaceStrong, true: palette.primary }}
          />
        </View>
      </SettingsCard>

      {/* 音源列表 */}
      {sources.length === 0 ? (
        <EmptyState
          icon={Code2}
          title="还没有导入自定义音源"
          description="使用上方按钮粘贴脚本文本，或选择本机 JS 文件导入。"
        />
      ) : (
        <View style={styles.list}>
          {sources.map((source, index) => (
            <SourceCard
              key={source.id}
              source={source}
              palette={palette}
              canMoveUp={index > 0}
              canMoveDown={index < sources.length - 1}
              onToggle={(enabled) => toggleSource(source.id, enabled)}
              onTest={() => testSource(source.id)}
              onCheckUpdate={() => checkSourceUpdate(source.id)}
              onRemove={() => handleRemove(source)}
              onMoveUp={() => moveSource(source.id, "up")}
              onMoveDown={() => moveSource(source.id, "down")}
              onToggleUpdateAlert={(enabled) => toggleUpdateAlert(source.id, enabled)}
              onOpenUpdateUrl={() => openCustomSourceUpdateUrl(source.updateUrl)}
            />
          ))}
        </View>
      )}

      {/* 导入弹窗 */}
      <Modal
        visible={importModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setImportModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: palette.surface }]}>
            <Text style={[styles.modalTitle, { color: palette.text }]}>导入自定义音源</Text>
            <Text style={[styles.modalHint, { color: palette.textMuted }]}>
              粘贴完整的 LX Music 自定义音源脚本（以 /* @name ... */ 开头的 JS 文本）
            </Text>
            <TextInput
              style={[
                styles.textArea,
                {
                  backgroundColor: palette.surfaceMuted,
                  color: palette.text,
                  borderColor: palette.border,
                },
              ]}
              value={scriptInput}
              onChangeText={setScriptInput}
              placeholder="在此粘贴脚本文本…"
              placeholderTextColor={palette.textSubtle}
              multiline
              textAlignVertical="top"
              autoFocus
            />
            <View style={styles.modalActions}>
              <ActionButton
                small
                label="取消"
                onPress={() => {
                  setImportModalVisible(false);
                  setScriptInput("");
                }}
              />
              <ActionButton
                small
                variant="primary"
                label="确认导入"
                loading={importing}
                onPress={() => void handleImport()}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

interface SourceCardProps {
  source: CustomSourceItem;
  palette: ReturnType<typeof getThemePalette>;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onCheckUpdate: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleUpdateAlert: (enabled: boolean) => void;
  onOpenUpdateUrl: () => void;
}

function SourceCard({
  source,
  palette,
  canMoveUp,
  canMoveDown,
  onToggle,
  onTest,
  onCheckUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  onToggleUpdateAlert,
  onOpenUpdateUrl,
}: SourceCardProps) {
  const isTesting = source.testStatus === "testing";
  const isChecking = source.updateStatus === "checking";
  const hasUpdate = source.updateStatus === "available";

  return (
    <SettingsCard style={styles.card}>
      {/* 头部：名称 + 启用开关 */}
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleWrap}>
          <Text style={[styles.cardName, { color: palette.text }]} numberOfLines={1}>
            {source.name}
          </Text>
          <View style={styles.cardMetaRow}>
            {source.version ? (
              <Text style={[styles.cardVersion, { color: palette.primary }]}>
                v{source.version}
              </Text>
            ) : null}
            {source.author ? (
              <Text style={[styles.cardAuthor, { color: palette.textMuted }]} numberOfLines={1}>
                {source.author}
              </Text>
            ) : null}
          </View>
          {source.description ? (
            <Text style={[styles.cardDesc, { color: palette.textSubtle }]} numberOfLines={2}>
              {source.description}
            </Text>
          ) : null}
        </View>
        <Switch
          value={source.enabled}
          onValueChange={onToggle}
          accessibilityRole="switch"
          accessibilityLabel={`启用音源 ${source.name}`}
          accessibilityState={{ checked: source.enabled, disabled: false }}
          trackColor={{ false: palette.surfaceStrong, true: palette.primary }}
        />
      </View>

      {/* 测试结果 */}
      {source.testMessage ? (
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor:
                source.testStatus === "ok"
                  ? palette.primary
                  : source.testStatus === "failed"
                    ? palette.dangerSurface
                    : palette.surfaceMuted,
            },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              {
                color:
                  source.testStatus === "ok" ? palette.primaryText : palette.textMuted,
              },
            ]}
            numberOfLines={2}
          >
            {source.testMessage}
          </Text>
        </View>
      ) : null}

      {/* 更新提示 */}
      {hasUpdate && source.allowShowUpdateAlert ? (
        <View style={[styles.updateAlert, { backgroundColor: palette.dangerSurface }]}>
          <Text style={[styles.updateAlertText, { color: palette.danger }]} numberOfLines={3}>
            {source.updateLog || source.updateMessage || "发现更新"}
          </Text>
          {source.updateUrl ? (
            <View style={styles.updateLinkRow}>
              <Text style={[styles.updateUrl, { color: palette.textSubtle }]} numberOfLines={1}>
                {source.updateUrl}
              </Text>
              <ActionButton
                small
                label="打开更新地址"
                onPress={onOpenUpdateUrl}
                accessibilityLabel="打开更新地址"
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {source.updateStatus === "latest" ? (
        <Text style={[styles.latestText, { color: palette.textSubtle }]}>已是最新版本</Text>
      ) : null}

      {/* 操作按钮 */}
      <View style={styles.cardActions}>
        <ActionButton
          small
          label="测试"
          loading={isTesting}
          onPress={onTest}
          accessibilityLabel={`测试音源 ${source.name}`}
        />
        <ActionButton
          small
          label="检测更新"
          loading={isChecking}
          onPress={onCheckUpdate}
          accessibilityLabel={`检测音源 ${source.name} 更新`}
        />
        <ActionButton
          small
          label="上移"
          disabled={!canMoveUp}
          onPress={onMoveUp}
          accessibilityLabel={`上移音源 ${source.name}`}
        />
        <ActionButton
          small
          label="下移"
          disabled={!canMoveDown}
          onPress={onMoveDown}
          accessibilityLabel={`下移音源 ${source.name}`}
        />
        <ActionButton
          small
          variant="danger"
          label="删除"
          onPress={onRemove}
          accessibilityLabel={`删除音源 ${source.name}`}
        />
      </View>

      {/* 更新提醒开关 */}
      <View style={styles.alertToggleRow}>
        <Text style={[styles.alertToggleLabel, { color: palette.textMuted }]}>
          显示更新提醒
        </Text>
        <Switch
          value={source.allowShowUpdateAlert}
          onValueChange={onToggleUpdateAlert}
          accessibilityRole="switch"
          accessibilityLabel={`显示音源 ${source.name} 更新提醒`}
          accessibilityState={{ checked: source.allowShowUpdateAlert, disabled: false }}
          trackColor={{ false: palette.surfaceStrong, true: palette.primary }}
        />
      </View>
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  // 作为 section 内嵌进二级设置页时的容器样式
  inlineContent: {
    gap: spacing.s,
  },
  headerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    alignItems: "center",
  },
  actionBar: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  autoCheckCard: {
    gap: spacing.xs,
  },
  autoCheckRow: {
    minHeight: touch.minTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  autoCheckTextWrap: {
    flex: 1,
    gap: 3,
  },
  autoCheckTitle: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  autoCheckSubtitle: {
    fontSize: typography.caption,
    lineHeight: 16,
  },
  list: {
    gap: spacing.s,
  },
  card: {
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.s,
  },
  cardTitleWrap: {
    flex: 1,
    gap: spacing.xxs,
  },
  cardName: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  cardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  cardVersion: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  cardAuthor: {
    fontSize: typography.caption,
    flexShrink: 1,
  },
  cardDesc: {
    fontSize: typography.caption,
    lineHeight: 16,
  },
  statusBadge: {
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: {
    fontSize: typography.caption,
    fontWeight: "500",
  },
  updateAlert: {
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  updateAlertText: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  updateUrl: {
    flex: 1,
    fontSize: typography.caption,
  },
  updateLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  latestText: {
    fontSize: typography.caption,
  },
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  alertToggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 4,
  },
  alertToggleLabel: {
    fontSize: typography.caption,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    borderRadius: radius.md,
    padding: spacing.m,
    gap: spacing.xs,
  },
  modalTitle: {
    fontSize: typography.heading,
    fontWeight: "700",
  },
  modalHint: {
    fontSize: typography.caption,
    lineHeight: 16,
  },
  textArea: {
    minHeight: 180,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: typography.meta,
    borderWidth: 1,
    fontFamily: "monospace",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
});
