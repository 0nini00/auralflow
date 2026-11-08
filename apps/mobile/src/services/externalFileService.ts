import { NativeModules } from "react-native";
import { parseMobileDeepLink } from "./mobileDeepLinkService";

interface ExternalFileInfo {
  fileName: string | null;
  mimeType: string | null;
}

interface ExternalFileNativeModule {
  getFileInfo(uri: string): Promise<ExternalFileInfo>;
}

export type ExternalFileIntent =
  | { type: "playAudio"; uri: string }
  | { type: "importSource"; uri: string; fileName: string | null };

const AUDIO_EXTENSION = /\.(mp3|m4a|m4b|flac|wav|aac|ogg|opus|amr)$/i;
const SCRIPT_EXTENSION = /\.(js|json)$/i;
const SCRIPT_MIME_TYPES = new Set([
  "application/javascript", "application/x-javascript", "text/javascript", "application/json", "text/json",
]);

function fileNameFromUri(url: URL): string | null {
  const tail = url.pathname.split("/").filter(Boolean).at(-1);
  if (!tail) return null;
  const name = decodeURIComponent(tail).split("/").at(-1) ?? "";
  // 不透明的文档 ID 不等于文件名；此时必须依赖提供方信息。
  return /\.[a-z0-9]+$/i.test(name) ? name : null;
}

export async function resolveExternalFile(uri: string): Promise<ExternalFileIntent> {
  const url = new URL(uri);
  if (url.protocol !== "content:" && url.protocol !== "file:") {
    throw new Error("只能打开本地文件");
  }
  const native = NativeModules.CustomSourceFilePickerModule as ExternalFileNativeModule | undefined;
  if (!native?.getFileInfo) throw new Error("外部文件读取模块不可用，请更新应用");
  const info = await native.getFileInfo(uri);
  if (!info || (info.fileName !== null && typeof info.fileName !== "string")
    || (info.mimeType !== null && typeof info.mimeType !== "string")) {
    throw new Error("外部文件信息无效");
  }
  const fileName = info.fileName?.trim() || fileNameFromUri(url);
  const mimeType = info.mimeType?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (fileName && SCRIPT_EXTENSION.test(fileName)) return { type: "importSource", uri, fileName };
  if ((fileName && AUDIO_EXTENSION.test(fileName)) || mimeType.startsWith("audio/") || mimeType === "application/ogg") {
    return { type: "playAudio", uri };
  }
  if ((!fileName || !/\.[a-z0-9]+$/i.test(fileName)) && SCRIPT_MIME_TYPES.has(mimeType)) {
    return { type: "importSource", uri, fileName };
  }
  throw new Error(fileName ? `不支持打开此文件：${fileName}` : "无法识别文件类型，请选择音频或 JS/JSON 音源文件");
}

export async function resolveMobileLink(rawUrl: string) {
  const intent = parseMobileDeepLink(rawUrl);
  return intent?.type === "openFile" ? resolveExternalFile(intent.uri) : intent;
}
