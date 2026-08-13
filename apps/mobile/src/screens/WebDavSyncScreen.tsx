import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  ScrollView,
  Switch,
} from "react-native";
import { ActionButton } from "@/components/ActionButton";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWebdavStore } from "@/stores/webdavStore";
import {
  getResolvedTheme,
  getThemePalette,
  useThemeStore,
} from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

/**
 * WebDAV 同步设置页面。
 *
 * 提供 WebDAV 服务配置（地址 / 用户名 / 密码）、连接测试，以及歌单与
 * 自定义音源的上传 / 下载操作。配置与同步状态通过 webdavStore 管理，
 * 颜色取自 themeStore，与桌面端 LX Music 同步格式兼容。
 */
export function WebDavSyncScreen() {
  const insets = useSafeAreaInsets();
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);

  const webdavUrl = useWebdavStore((state) => state.url);
  const webdavUsername = useWebdavStore((state) => state.username);
  const webdavPassword = useWebdavStore((state) => state.password);
  const webdavLoaded = useWebdavStore((state) => state.loaded);
  const autoSyncPlaylists = useWebdavStore((state) => state.autoSyncPlaylists);
  const webdavSyncing = useWebdavStore((state) => state.syncing);
  const webdavMessage = useWebdavStore((state) => state.message);
  const webdavLoadConfig = useWebdavStore((state) => state.loadConfig);
  const webdavSetConfig = useWebdavStore((state) => state.setConfig);
  const setAutoSyncPlaylists = useWebdavStore((state) => state.setAutoSyncPlaylists);
  const webdavTestSync = useWebdavStore((state) => state.testSync);
  const webdavUploadPlaylists = useWebdavStore((state) => state.uploadPlaylists);
  const webdavDownloadPlaylists = useWebdavStore(
    (state) => state.downloadPlaylists,
  );
  const webdavUploadSources = useWebdavStore((state) => state.uploadSources);
  const webdavDownloadSources = useWebdavStore(
    (state) => state.downloadSources,
  );

  const [formUrl, setFormUrl] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const actionInProgress = savingConfig || webdavSyncing;

  // 首次进入加载已保存的配置
  useEffect(() => {
    webdavLoadConfig();
  }, [webdavLoadConfig]);

  // 配置加载完成后同步到表单输入
  useEffect(() => {
    if (webdavLoaded) {
      setFormUrl(webdavUrl);
      setFormUsername(webdavUsername);
      setFormPassword(webdavPassword);
    }
  }, [webdavLoaded, webdavUrl, webdavUsername, webdavPassword]);

  const persistForm = async (): Promise<boolean> => {
    setSavingConfig(true);
    try {
      await webdavSetConfig({
        url: formUrl.trim(),
        username: formUsername.trim(),
        password: formPassword,
      });
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      Alert.alert("本地配置保存失败", detail);
      return false;
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSaveConfig = async () => {
    if (await persistForm()) {
      Alert.alert("已保存", "WebDAV 配置已保存");
    }
  };

  const handleTestSync = async () => {
    if (!(await persistForm())) return;
    await webdavTestSync();
  };

  const handleAutoSyncChange = async (enabled: boolean) => {
    if (enabled && (!formUrl.trim() || !formUsername.trim() || !formPassword)) {
      Alert.alert("请先配置 WebDAV", "请填写并保存 WebDAV 地址、用户名和密码后再开启自动同步。");
      return;
    }
    if (!(await persistForm())) return;
    try {
      setSavingConfig(true);
      await setAutoSyncPlaylists(enabled);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      Alert.alert("自动同步设置保存失败", detail);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleUploadPlaylists = async () => {
    if (!(await persistForm())) return;
    await webdavUploadPlaylists();
  };

  /** 下载歌单历史；若云端数据较旧被拦截，引导用户强制下载（对齐桌面端）。 */
  const runDownloadPlaylists = async (force?: boolean) => {
    if (!(await persistForm())) return;
    try {
      await webdavDownloadPlaylists(force);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!force && (detail.includes("较旧") || detail.includes("强制下载"))) {
        Alert.alert("云端数据较旧", `${detail}\n\n是否强制用云端合并本地？`, [
          { text: "取消", style: "cancel" },
          {
            text: "强制下载",
            onPress: () => void runDownloadPlaylists(true),
          },
        ]);
      }
    }
  };

  const handleDownloadPlaylists = () => {
    Alert.alert(
      "确认下载",
      "从 WebDAV 下载将合并本地的收藏、歌单和播放历史（并集去重，保留本地独有内容），是否继续？",
      [
        { text: "取消", style: "cancel" },
        {
          text: "下载",
          onPress: () => void runDownloadPlaylists(),
        },
      ],
    );
  };

  const handleUploadSources = async () => {
    if (!(await persistForm())) return;
    await webdavUploadSources();
  };

  /** 下载自定义音源；若云端数据较旧被拦截，引导用户强制下载（对齐桌面端）。 */
  const runDownloadSources = async (force?: boolean) => {
    if (!(await persistForm())) return;
    try {
      await webdavDownloadSources(force);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!force && (detail.includes("较旧") || detail.includes("强制下载"))) {
        Alert.alert("云端数据较旧", `${detail}\n\n是否强制用云端覆盖本地音源？`, [
          { text: "取消", style: "cancel" },
          {
            text: "强制下载",
            onPress: () => void runDownloadSources(true),
          },
        ]);
      }
    }
  };

  const handleDownloadSources = () => {
    Alert.alert(
      "确认下载",
      "从 WebDAV 下载将覆盖本地自定义音源，是否继续？",
      [
        { text: "取消", style: "cancel" },
        {
          text: "下载",
          onPress: () => void runDownloadSources(),
        },
      ],
    );
  };

  const messageIsSuccess =
    webdavMessage.includes("成功") || webdavMessage.includes("正常");

  return (
    <View
      style={[styles.container, { backgroundColor: palette.background }]}
    >
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* 配置区 */}
        <View
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            WebDAV 配置
          </Text>
          <Text style={[styles.cardCaption, { color: palette.textMuted }]}>
            填写服务地址与账号信息，与 LX Music 桌面端兼容。
          </Text>

          <Text style={[styles.label, { color: palette.textMuted }]}>
            WebDAV 地址
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: palette.surfaceMuted,
                color: palette.text,
                borderColor: palette.border,
              },
            ]}
            value={formUrl}
            onChangeText={setFormUrl}
            placeholder="https://dav.jianguoyun.com/dav/"
            placeholderTextColor={palette.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="WebDAV 地址"
            accessibilityHint="输入 WebDAV 服务地址，例如 https://dav.jianguoyun.com/dav/"
          />

          <Text style={[styles.label, { color: palette.textMuted }]}>
            用户名
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: palette.surfaceMuted,
                color: palette.text,
                borderColor: palette.border,
              },
            ]}
            value={formUsername}
            onChangeText={setFormUsername}
            placeholder="用户名 / 邮箱"
            placeholderTextColor={palette.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="WebDAV 用户名"
            accessibilityHint="输入 WebDAV 用户名或邮箱"
          />

          <Text style={[styles.label, { color: palette.textMuted }]}>
            密码 / 应用密码
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: palette.surfaceMuted,
                color: palette.text,
                borderColor: palette.border,
              },
            ]}
            value={formPassword}
            onChangeText={setFormPassword}
            placeholder="应用密码"
            placeholderTextColor={palette.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            accessibilityLabel="WebDAV 密码或应用密码"
            accessibilityHint="安全输入 WebDAV 密码或应用密码，输入内容将被隐藏"
          />

          <View style={styles.buttonRow}>
            <ActionButton
              shrink
              small
              label="保存配置"
              disabled={actionInProgress}
              loading={savingConfig}
              onPress={() => void handleSaveConfig()}
              accessibilityLabel="保存 WebDAV 配置"
            />
            <ActionButton
              shrink
              small
              label="测试连接"
              disabled={actionInProgress}
              loading={webdavSyncing}
              onPress={() => void handleTestSync()}
              accessibilityLabel="测试 WebDAV 连接"
            />
          </View>
        </View>

        {/* 歌单历史同步区 */}
        <View
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            歌单历史同步
          </Text>
          <Text style={[styles.cardCaption, { color: palette.textMuted }]}>
            上传将覆盖远端收藏、歌单与播放历史；下载将与本地合并，保留本地独有内容。
          </Text>

          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={[styles.switchTitle, { color: palette.text }]}>自动同步歌单历史</Text>
              <Text style={[styles.switchCaption, { color: palette.textMuted }]}>应用启动时先合并云端数据，再上传本地结果</Text>
            </View>
            <Switch
              value={autoSyncPlaylists}
              onValueChange={(enabled) => void handleAutoSyncChange(enabled)}
              disabled={actionInProgress}
              accessibilityRole="switch"
              accessibilityLabel="自动同步歌单历史"
              accessibilityState={{
                disabled: actionInProgress,
                busy: savingConfig,
                checked: autoSyncPlaylists,
              }}
              style={styles.switchControl}
              trackColor={{ false: palette.border, true: palette.primary }}
              thumbColor={palette.surface}
            />
          </View>

          <View style={styles.buttonRow}>
            <ActionButton
              shrink
              small
              variant="primary"
              label="上传歌单历史"
              loading={webdavSyncing}
              disabled={actionInProgress}
              onPress={() => void handleUploadPlaylists()}
              accessibilityLabel="上传歌单历史到 WebDAV"
            />
            <ActionButton
              shrink
              small
              label="下载歌单历史"
              disabled={actionInProgress}
              onPress={handleDownloadPlaylists}
              accessibilityLabel="从 WebDAV 下载歌单历史"
            />
          </View>
        </View>

        {/* 音源同步区 */}
        <View
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            音源同步
          </Text>
          <Text style={[styles.cardCaption, { color: palette.textMuted }]}>
            上传或下载 LX Music 自定义音源，覆盖远端或本机的 user_apis.json。
          </Text>

          <View style={styles.buttonRow}>
            <ActionButton
              shrink
              small
              label="上传音源"
              disabled={actionInProgress}
              onPress={() => void handleUploadSources()}
              accessibilityLabel="上传音源到 WebDAV"
            />
            <ActionButton
              shrink
              small
              label="下载音源"
              disabled={actionInProgress}
              onPress={handleDownloadSources}
              accessibilityLabel="从 WebDAV 下载音源"
            />
          </View>
        </View>

        {/* 同步状态 / 错误提示 */}
        {webdavMessage ? (
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[
              styles.messageBox,
              {
                backgroundColor: messageIsSuccess
                  ? palette.surfaceMuted
                  : palette.dangerSurface,
              },
            ]}
          >
            <Text
              style={[
                styles.messageText,
                { color: messageIsSuccess ? palette.text : palette.danger },
              ]}
            >
              {webdavMessage}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.m,
    gap: spacing.m,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.m,
  },
  cardTitle: {
    fontSize: typography.title,
    fontWeight: "700",
    marginBottom: spacing.xxs,
  },
  cardCaption: {
    fontSize: typography.meta,
    marginBottom: spacing.s,
  },
  label: {
    fontSize: typography.meta,
    fontWeight: "500",
    marginTop: spacing.s,
    marginBottom: spacing.xxs,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
    fontSize: typography.body,
  },
  switchRow: {
    minHeight: touch.minTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  switchCopy: {
    flex: 1,
    minWidth: 0,
  },
  switchControl: {
    minWidth: touch.minTarget,
    minHeight: touch.minTarget,
  },
  switchTitle: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  switchCaption: {
    fontSize: typography.caption,
    marginTop: 2,
  },
  buttonRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.m,
  },
  messageBox: {
    padding: spacing.s,
    borderRadius: radius.sm,
  },
  messageText: {
    fontSize: typography.body,
    lineHeight: 20,
  },
});
