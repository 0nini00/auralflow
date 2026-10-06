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

export async function validateDownloadedFile(path: string, bytesWritten?: number): Promise<void> {
  const size = Number((await RNFS.stat(path)).size);
  if (!Number.isFinite(size) || size <= 0) throw new Error("下载文件为空或大小无效");
  if (bytesWritten !== undefined && (!Number.isFinite(bytesWritten) || bytesWritten <= 0 || size !== bytesWritten)) {
    throw new Error("下载文件大小与已写入字节数不一致");
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
