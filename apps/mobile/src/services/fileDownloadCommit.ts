import RNFS from "react-native-fs";
import { NativeModules } from "react-native";

interface DownloadFileNativeModule {
  commitDownload(partialPath: string, finalPath: string): Promise<void>;
}

const PARTIAL_SUFFIX = ".part";
let nextAttempt = 0;

/** 每次尝试使用独立临时文件，迟到的原生下载不能覆盖重试的文件。 */
export function createPartialDownloadPath(finalPath: string): string {
  return `${finalPath}.${Date.now()}-${++nextAttempt}${PARTIAL_SUFFIX}`;
}

export function isPartialDownload(path: string): boolean {
  return path.endsWith(PARTIAL_SUFFIX);
}

/** 只在该目录开始接收任务前调用，不能清理正在写入的临时文件。 */
export async function removeOrphanedPartialDownloads(directory: string): Promise<void> {
  for (const entry of await RNFS.readDir(directory)) {
    if (entry.isFile() && isPartialDownload(entry.name)) await RNFS.unlink(entry.path);
  }
}

/** 嗅探窗口：音频容器头与错误页都在文件开头就能区分。 */
const SNIFF_BYTES = 512;

/**
 * 文本负载识别：CDN / 代理在链接过期、无版权、鉴权失败时经常返回
 * **HTTP 200 + HTML 错误页**，只校验字节数会把整页 HTML 当音频提交。
 *
 * 只看「像不像文本」，不强制匹配音频魔数：部分源站会包一层自定义头，
 * 强制命中 ID3/fLaC 之类的容器头会把正常文件误杀。
 */
function looksLikeTextPayload(head: string): boolean {
  const payload = head.replace(/^\uFEFF/, "").trimStart().toLowerCase();
  return (
    payload.startsWith("<!doctype") ||
    payload.startsWith("<html") ||
    payload.startsWith("<?xml") ||
    payload.startsWith("#extm3u") ||
    payload.startsWith("{") ||
    payload.startsWith("[")
  );
}

export async function validateDownloadedFile(path: string, bytesWritten?: number): Promise<void> {
  const size = Number((await RNFS.stat(path)).size);
  if (!Number.isFinite(size) || size <= 0) throw new Error("下载文件为空或大小无效");
  if (bytesWritten !== undefined && (!Number.isFinite(bytesWritten) || bytesWritten <= 0 || size !== bytesWritten)) {
    throw new Error("下载文件大小与已写入字节数不一致");
  }

  // 读首块做内容校验。读失败不阻断（老平台/权限异常时宁可放行已验证大小的文件）。
  let head = "";
  try {
    head = await RNFS.read(path, Math.min(SNIFF_BYTES, size), 0, "utf8");
  } catch {
    return;
  }
  if (looksLikeTextPayload(head)) {
    throw new Error("下载地址返回的是网页/文本而不是音频文件，可能已失效或无版权");
  }
}

/** 同目录提交：最终文件名只对完成下载并通过校验的内容可见。 */
export async function commitDownloadedFile(partialPath: string, finalPath: string, bytesWritten?: number): Promise<void> {
  await validateDownloadedFile(partialPath, bytesWritten);
  const native = NativeModules.DownloadFileModule as DownloadFileNativeModule | undefined;
  if (!native) throw new Error("下载提交模块不可用，请安装包含 DownloadFileModule 的新版应用");
  await native.commitDownload(partialPath, finalPath);
}

export async function discardPartialDownload(path: string): Promise<void> {
  if (!isPartialDownload(path)) throw new Error("拒绝将已完成文件作为临时下载清理");
  if (await RNFS.exists(path)) await RNFS.unlink(path);
}
