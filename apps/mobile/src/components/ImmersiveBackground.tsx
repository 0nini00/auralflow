import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, StyleSheet, View } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import {
  createImmersiveBackgroundDocument,
  createImmersiveBackgroundUpdate,
} from '@/services/immersiveBackgroundDocument';
import { logger } from '@/services/logger';

export interface ImmersiveBackgroundProps {
  color: string;
  accent: string;
  playing: boolean;
  active: boolean;
  onError: (message: string) => void;
}

const READY_TIMEOUT_MS = 10_000;
const DISPOSE_SCRIPT = 'if(window.AuralFlowImmersiveBackground){window.AuralFlowImmersiveBackground.dispose();}true;';

export const ImmersiveBackground = memo(function ImmersiveBackground(props: ImmersiveBackgroundProps) {
  const [rendererVersion, setRendererVersion] = useState(0);
  const replaceRenderer = useCallback(() => setRendererVersion(version => version + 1), []);
  return <ImmersiveBackgroundRenderer key={rendererVersion} {...props} onProcessGone={replaceRenderer} />;
});

function ImmersiveBackgroundRenderer(props: ImmersiveBackgroundProps & { onProcessGone: () => void }) {
  const webview = useRef<WebView<unknown> | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const mounted = useRef(false);
  const ready = useRef(false);
  const processTerminated = useRef(false);
  const appActive = useRef(AppState.currentState === 'active');
  // 等待系统偏好时先绘静帧，避免首屏短暂播放用户已关闭的动效。
  const reducedMotion = useRef(true);
  const lastError = useRef('');
  const recoveryError = useRef<{ source: 'load' | 'graphics'; message: string } | null>(null);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const source = useMemo(() => ({ html: createImmersiveBackgroundDocument(), baseUrl: 'about:blank' }), []);

  const clearReadyTimer = useCallback(() => {
    if (readyTimer.current !== null) clearTimeout(readyTimer.current);
    readyTimer.current = null;
  }, []);
  const report = useCallback((message: string) => {
    if (!mounted.current) return;
    if (message && message !== lastError.current) logger.error('[ImmersiveBackground]', message);
    lastError.current = message;
    latest.current.onError(message);
  }, []);
  const sendConfiguration = useCallback(() => {
    if (!mounted.current) return;
    // 已终止的原生 WebView 不能复用；在播放器可见时才创建替代实例。
    if (processTerminated.current) {
      if (latest.current.active && appActive.current) latest.current.onProcessGone();
      return;
    }
    if (!ready.current || !webview.current) return;
    const { color, accent, playing, active } = latest.current;
    try {
      webview.current.injectJavaScript(createImmersiveBackgroundUpdate({
        color, accent, playing, active: active && appActive.current, reducedMotion: reducedMotion.current,
      }));
    } catch (error) {
      report(error instanceof Error ? error.message : String(error));
    }
  }, [report]);
  const loadFailed = useCallback((message: string) => {
    ready.current = false;
    clearReadyTimer();
    recoveryError.current = { source: 'load', message };
    report(message);
  }, [clearReadyTimer, report]);
  const handleLoadStart = useCallback(() => {
    if (processTerminated.current) return;
    ready.current = false;
    clearReadyTimer();
    readyTimer.current = setTimeout(() => loadFailed('沉浸背景加载超时，请重新打开播放器重试'), READY_TIMEOUT_MS);
  }, [clearReadyTimer, loadFailed]);
  const handleProcessGone = useCallback((message: string) => {
    if (!mounted.current || processTerminated.current) return;
    processTerminated.current = true;
    loadFailed(message);
    sendConfiguration();
  }, [loadFailed, sendConfiguration]);

  useEffect(() => {
    mounted.current = true;
    const instance = webview.current;
    let alive = true;
    let motionChanged = false;
    let preferenceError = '';
    const appSubscription = AppState.addEventListener('change', state => {
      appActive.current = state === 'active';
      sendConfiguration();
    });
    const motionSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      motionChanged = true;
      reducedMotion.current = value;
      if (preferenceError && lastError.current === preferenceError) {
        report(recoveryError.current?.message ?? '');
      }
      preferenceError = '';
      sendConfiguration();
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (!alive || motionChanged) return;
      reducedMotion.current = value;
      sendConfiguration();
    }).catch(error => {
      if (!alive || motionChanged) return;
      preferenceError = `无法读取系统动态效果偏好：${error instanceof Error ? error.message : String(error)}`;
      report(preferenceError);
    });
    return () => {
      mounted.current = false;
      alive = false;
      ready.current = false;
      clearReadyTimer();
      appSubscription.remove();
      motionSubscription.remove();
      try {
        if (!processTerminated.current) instance?.injectJavaScript(DISPOSE_SCRIPT);
      } catch (error) {
        logger.error('[ImmersiveBackground] 背景清理失败', error);
      }
    };
  }, [clearReadyTimer, report, sendConfiguration]);

  useEffect(() => { sendConfiguration(); }, [props.color, props.accent, props.playing, props.active, sendConfiguration]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    if (!mounted.current || processTerminated.current) return;
    let message: { channel?: unknown; type?: unknown; message?: unknown } | null;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      report('沉浸背景返回了无效消息');
      return;
    }
    if (!message || message.channel !== 'auralflow-immersive-background') {
      report('沉浸背景消息来源无效');
      return;
    }
    if (message.type === 'ready' || message.type === 'restored') {
      ready.current = true;
      clearReadyTimer();
      const error = recoveryError.current;
      if (error && (error.source === 'load' || message.type === 'restored')) {
        if (lastError.current === error.message) report('');
        recoveryError.current = null;
      }
      // 替代实例首次就绪时，清除父界面保留的旧进程错误，不覆盖自身的新错误。
      if (!lastError.current) report('');
      sendConfiguration();
      return;
    }
    if (message.type === 'error' && typeof message.message === 'string' && message.message.trim()) {
      clearReadyTimer();
      recoveryError.current = { source: 'graphics', message: message.message };
      report(message.message);
      return;
    }
    report('沉浸背景消息格式无效');
  }, [clearReadyTimer, report, sendConfiguration]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none"
      accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView
        ref={webview}
        source={source}
        style={styles.webview}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        scrollEnabled={false}
        bounces={false}
        javaScriptEnabled
        domStorageEnabled={false}
        cacheEnabled={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        mixedContentMode="never"
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        // 不匹配白名单的地址会被该库交给 Linking；全部进入下面的拒绝判断才不会打开外部应用。
        originWhitelist={['*']}
        onShouldStartLoadWithRequest={request => {
          if (request.url === 'about:blank') return true;
          loadFailed('沉浸背景拒绝了外部页面导航');
          return false;
        }}
        onLoadStart={handleLoadStart}
        onMessage={handleMessage}
        onError={event => loadFailed(`沉浸背景加载失败：${event.nativeEvent.description}`)}
        onHttpError={event => loadFailed(`沉浸背景页面请求失败：HTTP ${event.nativeEvent.statusCode}`)}
        onRenderProcessGone={() => handleProcessGone('沉浸背景渲染进程已退出，返回播放器时重建')}
        onContentProcessDidTerminate={() => handleProcessGone('沉浸背景页面进程已终止，返回播放器时重建')}
      />
    </View>
  );
}

const styles = StyleSheet.create({ webview: { flex: 1, backgroundColor: 'transparent' } });
