/**
 * 自定义音源 WebView 桥宿主（移动端 Android）。
 *
 * 背景：Hermes（release）不支持 new Function/eval，LX 用户音源脚本无法在
 * RN JS 线程执行。此组件渲染一个 1px 隐藏 WebView（加载 android assets 的
 * lx_bridge/index.html），用户脚本在 WebView 内核中执行，RN↔WebView 通过
 * postMessage(JSON) 通信；协议与消息格式见 index.html 头部注释。
 *
 * 用法：<LxBridgeHost/> 挂在 App 根部一次；业务侧经 waitForBridge() 等就绪、
 * sendToWebView() 发消息、setLxBridgeHandlers() 注册回调。
 */
import { useCallback, useEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";

/** WV→RN 桥消息（字段见 lx_bridge/index.html 协议注释） */
export interface LxBridgeInbound {
  type: "ready" | "inited" | "updateAlert" | "error" | "http" | "request-response";
  rid?: string;
  sources?: unknown;
  updateAlert?: unknown;
  alert?: unknown;
  message?: string;
  id?: string;
  url?: string;
  options?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

type BridgeHandlers = {
  onMessage: (msg: LxBridgeInbound) => void;
  onError: (message: string) => void;
};

let handlers: BridgeHandlers = {
  onMessage: () => undefined,
  onError: () => undefined,
};

let webviewRef: WebView<unknown> | null = null;
let bridgeReady = false;
let readyWaiters: Array<() => void> = [];

export function setLxBridgeHandlers(next: Partial<BridgeHandlers>): void {
  handlers = { ...handlers, ...next };
}

/** 等待桥就绪（HTML ready 消息）；超时抛错 */
export function waitForBridge(timeoutMs = 12_000): Promise<void> {
  if (bridgeReady) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      readyWaiters = readyWaiters.filter((w) => w !== wrapped);
      reject(new Error("自定义音源 WebView 桥加载超时"));
    }, timeoutMs);
    const wrapped = () => {
      clearTimeout(timer);
      resolve();
    };
    readyWaiters.push(wrapped);
  });
}

/** RN→WV：JSON 序列化后经 injectJavaScript 派发到 window 'message' 事件 */
export function sendToWebView(msg: Record<string, unknown>): void {
  if (!webviewRef || !bridgeReady) return;
  const json = JSON.stringify(JSON.stringify(msg));
  webviewRef.injectJavaScript(
    `try{window.dispatchEvent(new MessageEvent('message',{data:${json}}));}catch(e){};true;`,
  );
}

/**
 * 桥宿主组件：App 根部挂载一次。仅 Android 渲染 WebView（iOS/桌面不需要）。
 */
export function LxBridgeHost(): React.ReactElement | null {
  const ref = useRef<WebView<unknown> | null>(null);

  useEffect(() => {
    webviewRef = ref.current;
    return () => {
      webviewRef = null;
      bridgeReady = false;
    };
  }, []);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    let parsed: LxBridgeInbound | null = null;
    try {
      parsed = JSON.parse(event.nativeEvent.data) as LxBridgeInbound;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    if (parsed.type === "ready") {
      if (!bridgeReady) {
        bridgeReady = true;
        const waiters = readyWaiters;
        readyWaiters = [];
        for (const w of waiters) w();
      }
      return;
    }
    handlers.onMessage(parsed);
  }, []);

  const handleError = useCallback((e: { nativeEvent: { description?: string } }) => {
    handlers.onError(e.nativeEvent?.description ?? "WebView 桥加载失败");
  }, []);

  if (Platform.OS !== "android") return null;
  return (
    <View style={styles.host} pointerEvents="none">
      <WebView
        ref={ref}
        source={{ uri: "file:///android_asset/lx_bridge/index.html" }}
        style={styles.webview}
        javaScriptEnabled
        originWhitelist={["*"]}
        mixedContentMode="always"
        allowFileAccessFromFileURLs
        onMessage={handleMessage}
        onError={handleError}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", top: 0, left: 0, width: 1, height: 1, opacity: 0 },
  webview: { width: 1, height: 1, opacity: 0 },
});
