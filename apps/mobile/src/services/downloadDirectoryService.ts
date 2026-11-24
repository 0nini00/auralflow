import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, Platform } from "react-native";

export interface DownloadDirectory {
  /** SAF tree URI，持久授权由原生侧取得。 */
  uri: string;
  /** 用户可见的文件夹名。 */
  name: string;
}

interface DownloadFileNativeModule {
  pickDownloadDirectory(): Promise<DownloadDirectory | null>;
  copyFileToDirectory(sourcePath: string, treeUri: string, fileName: string): Promise<string>;
  deleteFile(documentUri: string): Promise<boolean>;
  getFileSize(documentUri: string): Promise<number>;
}

const STORAGE_KEY = "auralflow.mobile.downloadDirectory";
const nativeModule = NativeModules.DownloadFileModule as DownloadFileNativeModule | undefined;

let cached: DownloadDirectory | null | undefined;

/** 未设置时返回 null，表示只保存到应用默认下载目录。 */
export async function loadDownloadDirectory(): Promise<DownloadDirectory | null> {
  if (cached !== undefined) return cached;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    cached = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DownloadDirectory>;
    cached = typeof parsed.uri === "string" && parsed.uri && typeof parsed.name === "string" && parsed.name
      ? { uri: parsed.uri, name: parsed.name }
      : null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function saveDownloadDirectory(directory: DownloadDirectory): Promise<void> {
  cached = directory;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(directory));
}

export async function clearDownloadDirectory(): Promise<void> {
  cached = null;
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/** 打开系统文件夹选择器；取消时返回 null。 */
export async function pickDownloadDirectory(): Promise<DownloadDirectory | null> {
  if (Platform.OS !== "android") throw new Error("当前平台不支持选择下载文件夹");
  if (!nativeModule?.pickDownloadDirectory) {
    throw new Error("下载文件夹模块不可用，请安装包含 DownloadFileModule 的新版应用");
  }
  const picked = await nativeModule.pickDownloadDirectory();
  if (picked) await saveDownloadDirectory(picked);
  return picked;
}

/**
 * 下载完成后额外复制一份到用户选择的文件夹。
 * 未设置目录时返回 null；复制失败由调用方转成下载警告，不影响应用内副本。
 */
export async function copyDownloadToDirectory(filePath: string): Promise<string | null> {
  const directory = await loadDownloadDirectory();
  if (!directory) return null;
  if (!nativeModule?.copyFileToDirectory) {
    throw new Error("下载文件夹模块不可用，请安装包含 DownloadFileModule 的新版应用");
  }
  const fileName = filePath.split(/[\\/]/).pop();
  if (!fileName) throw new Error("无法确定下载文件名");
  return nativeModule.copyFileToDirectory(filePath, directory.uri, fileName);
}

/**
 * 把下载文件移动到所选文件夹，返回音频的 document URI。
 * 调用方负责在成功后删除应用内副本；这里只负责复制，失败时不产生半份记录。
 */
export async function moveDownloadToDirectory(filePath: string): Promise<string | null> {
  const directory = await loadDownloadDirectory();
  if (!directory) return null;
  if (!nativeModule?.copyFileToDirectory) {
    throw new Error("下载文件夹模块不可用，请安装包含 DownloadFileModule 的新版应用");
  }
  const fileName = filePath.split(/[\\/]/).pop();
  if (!fileName) throw new Error("无法确定下载文件名");
  return nativeModule.copyFileToDirectory(filePath, directory.uri, fileName);
}

/** 删除所选文件夹中的下载文件。 */
export async function deleteDownloadDirectoryFile(documentUri: string): Promise<boolean> {
  if (!nativeModule?.deleteFile) {
    throw new Error("下载文件夹模块不可用，请安装包含 DownloadFileModule 的新版应用");
  }
  return nativeModule.deleteFile(documentUri);
}

/** 查询所选文件夹中的文件大小；失败时返回 0（显示未知大小）。 */
export async function getDownloadDirectoryFileSize(documentUri: string): Promise<number> {
  if (!nativeModule?.getFileSize) return 0;
  try {
    return await nativeModule.getFileSize(documentUri);
  } catch {
    return 0;
  }
}
