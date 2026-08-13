import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Linking,
} from "react-native";
import { CachedImage } from "@/components/CachedImage";
import {
  getQrCodeKey,
  getQrCodeUrl,
  checkQrLoginStatus,
  type QrLoginStatus,
} from "@/services/wyQrLoginService";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

const POLL_INTERVAL_MS = 2000;
/** 二维码有效期（网易云约为 2 分钟），到期前主动刷新。 */
const QR_LIFETIME_MS = 110 * 1000;

/** 归一化状态码（与 wyQrLoginService 对齐） */
const QR_CODE = {
  WAITING: 501,
  SCANNED: 502,
  SUCCESS: 200,
  EXPIRED: 500,
} as const;

const STATUS_TEXT: Record<number, string> = {
  [QR_CODE.WAITING]: "等待扫码",
  [QR_CODE.SCANNED]: "已扫码，请在网易云音乐中确认授权",
  [QR_CODE.SUCCESS]: "登录成功",
  [QR_CODE.EXPIRED]: "二维码已过期，正在刷新…",
};

interface QrLoginViewProps {
  /** 登录成功后回调，参数为拿到的 cookie（已由上层保存）。 */
  onSuccess: (cookie: string) => void;
  /** 可选：登录失败时的回调。 */
  onError?: (message: string) => void;
  /** 可选：用于在生成/轮询期间禁用外部控件。 */
  onBusyChange?: (busy: boolean) => void;
}

export function QrLoginView({
  onSuccess,
  onError,
  onBusyChange,
}: QrLoginViewProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("正在生成二维码…");
  const [busy, setBusy] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lifetimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const refreshingRef = useRef(false);

  const setBusyState = useCallback(
    (value: boolean) => {
      setBusy(value);
      onBusyChange?.(value);
    },
    [onBusyChange]
  );

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (lifetimeTimerRef.current) {
      clearTimeout(lifetimeTimerRef.current);
      lifetimeTimerRef.current = null;
    }
    pollInFlightRef.current = false;
  }, []);

  const handleSuccess = useCallback(
    (cookie: string) => {
      stopPolling();
      setStatusText(STATUS_TEXT[QR_CODE.SUCCESS]);
      onSuccess(cookie);
    },
    [onSuccess, stopPolling]
  );

  /**
   * 生成新的二维码并开始轮询。
   * autoRefresh=true 表示是过期自动刷新触发的，不抛 Alert。
   */
  const generateQrCode = useCallback(
    async (autoRefresh = false) => {
      if (refreshingRef.current) {
        return;
      }
      refreshingRef.current = true;
      stopPolling();
      if (!autoRefresh) {
        setBusyState(true);
        setStatusText("正在生成二维码…");
      }
      setQrImageUrl(null);

      try {
        const key = await getQrCodeKey();
        if (!mountedRef.current) {
          return;
        }
        const imageUrl = getQrCodeUrl(key);
        setQrImageUrl(imageUrl);
        setStatusText(STATUS_TEXT[QR_CODE.WAITING]);

        // 二维码到期前自动刷新
        lifetimeTimerRef.current = setTimeout(() => {
          if (mountedRef.current) {
            setStatusText(STATUS_TEXT[QR_CODE.EXPIRED]);
            void generateQrCode(true);
          }
        }, QR_LIFETIME_MS);

        beginPolling(key);
      } catch (error) {
        if (!mountedRef.current) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "生成二维码失败";
        setStatusText(message);
        if (!autoRefresh) {
          onError?.(message);
        }
      } finally {
        if (mountedRef.current) {
          setBusyState(false);
        }
        refreshingRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopPolling, setBusyState, onError]
  );

  const beginPolling = useCallback(
    (key: string) => {
      stopPolling();

      const run = async () => {
        if (!mountedRef.current) {
          return;
        }
        if (pollInFlightRef.current) {
          pollTimerRef.current = setTimeout(run, POLL_INTERVAL_MS);
          return;
        }

        pollInFlightRef.current = true;
        try {
          const result: QrLoginStatus = await checkQrLoginStatus(key);
          if (!mountedRef.current) {
            return;
          }

          const nextText = STATUS_TEXT[result.code] || result.message;
          setStatusText(nextText);

          if (result.code === QR_CODE.SUCCESS && result.cookie) {
            handleSuccess(result.cookie);
            return;
          }

          if (result.code === QR_CODE.EXPIRED) {
            // 自动刷新
            void generateQrCode(true);
            return;
          }

          pollTimerRef.current = setTimeout(run, POLL_INTERVAL_MS);
        } catch (error) {
          if (!mountedRef.current) {
            return;
          }
          const message =
            error instanceof Error ? error.message : "二维码状态检查失败";
          setStatusText(message);
          onError?.(message);
          stopPolling();
        } finally {
          pollInFlightRef.current = false;
        }
      };

      void run();
    },
    [stopPolling, handleSuccess, generateQrCode, onError]
  );

  // 挂载时自动生成二维码
  useEffect(() => {
    mountedRef.current = true;
    void generateQrCode(false);
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualRefresh = () => {
    void generateQrCode(false);
  };

  const openQrUrl = async () => {
    if (!qrImageUrl) {
      return;
    }
    await Linking.openURL(qrImageUrl);
  };

  return (
    <View style={[styles.qrPanel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={[styles.qrPreview, { borderColor: palette.border }]}>
        {qrImageUrl ? (
          <CachedImage uri={qrImageUrl} style={styles.qrImage} />
        ) : (
          <View style={styles.qrPlaceholder}>
            {busy ? (
              <ActivityIndicator color={palette.textMuted} />
            ) : (
              <Text style={[styles.qrPlaceholderText, { color: palette.textMuted }]}>等待生成二维码</Text>
            )}
          </View>
        )}
      </View>

      <Text style={[styles.qrStatus, { color: palette.text }]}>{statusText}</Text>

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, { backgroundColor: palette.primary }, busy && styles.buttonDisabled]}
          onPress={handleManualRefresh}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={palette.primaryText} />
          ) : (
            <Text style={[styles.buttonText, { color: palette.primaryText }]}>刷新二维码</Text>
          )}
        </Pressable>

        {qrImageUrl ? (
          <Pressable style={[styles.secondaryButton, { borderColor: palette.border }]} onPress={openQrUrl}>
            <Text style={[styles.secondaryButtonText, { color: palette.primary }]}>在浏览器打开</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  qrPanel: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 16,
    alignItems: "center",
  },
  qrPreview: {
    width: 220,
    height: 220,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginBottom: 16,
  },
  qrImage: {
    width: "100%",
    height: "100%",
  },
  qrPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  qrPlaceholderText: {
    fontSize: 14,
    textAlign: "center",
  },
  qrStatus: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 12,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: "center",
    minWidth: 120,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  secondaryButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
