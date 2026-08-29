import { NativeModules, Platform } from "react-native";
import RNFS from "react-native-fs";

/**
 * APK 应用内安装原生桥接（仅 Android）。
 *
 * 配合 updateService 使用：从 GitHub Releases 下载 APK 到缓存目录后，
 * 通过系统安装器完成安装。Android 8+ 需要用户授予「安装未知应用」权限。
 */
interface NativeApkInstallerModule {
  /** 设备支持的 ABI 列表，按系统偏好顺序（如 ["arm64-v8a", "armeabi-v7a", ...]） */
  getSupportedAbis(): Promise<string[]>;
  hasInstallPermission(): Promise<boolean>;
  openInstallPermissionSettings(): Promise<boolean>;
  /** 拉起系统安装器。文件不存在/过小时抛错。 */
  installApk(path: string): Promise<boolean>;
}

const nativeModule = (NativeModules as Record<string, unknown>).ApkInstallerModule as
  | NativeApkInstallerModule
  | undefined;

export function isApkInstallSupported(): boolean {
  return Platform.OS === "android" && nativeModule != null;
}

export async function getSupportedAbis(): Promise<string[]> {
  if (!nativeModule) return [];
  return nativeModule.getSupportedAbis();
}

export async function hasInstallPermission(): Promise<boolean> {
  if (!nativeModule) return false;
  return nativeModule.hasInstallPermission();
}

export async function openInstallPermissionSettings(): Promise<boolean> {
  if (!nativeModule) return false;
  return nativeModule.openInstallPermissionSettings();
}

export async function installApk(path: string): Promise<boolean> {
  if (!nativeModule) throw new Error("当前设备不支持应用内安装");
  return nativeModule.installApk(path);
}

const UPDATE_DIR = `${RNFS.CachesDirectoryPath}/updates`;

export function getApkDownloadPath(fileName: string): string {
  return `${UPDATE_DIR}/${fileName}`;
}

/** APK 是否已经下载完成（授权后回到应用可直接安装，无需重下） */
export async function isApkDownloaded(path: string): Promise<boolean> {
  try {
    return await RNFS.exists(path);
  } catch {
    return false;
  }
}

export interface ApkDownloadProgress {
  bytesWritten: number;
  contentLength: number;
}

export async function downloadApk(
  url: string,
  path: string,
  jobIdRef: { current: number | null },
  onProgress: (progress: ApkDownloadProgress) => void,
): Promise<void> {
  await RNFS.mkdir(UPDATE_DIR);
  const job = RNFS.downloadFile({
    fromUrl: url,
    toFile: path,
    progressInterval: 300,
    progress: (res) => {
      onProgress({ bytesWritten: res.bytesWritten, contentLength: res.contentLength });
    },
  });
  jobIdRef.current = job.jobId;
  try {
    const result = await job.promise;
    if (result.statusCode && result.statusCode >= 400) {
      await RNFS.unlink(path).catch(() => undefined);
      throw new Error(`下载失败（HTTP ${result.statusCode}）`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 主动取消不算失败；其余情况清掉半截文件
    if (message !== "Download has been aborted") {
      await RNFS.unlink(path).catch(() => undefined);
      throw new Error(message);
    }
  } finally {
    jobIdRef.current = null;
  }
}

export function cancelApkDownload(jobIdRef: { current: number | null }): void {
  if (jobIdRef.current == null) return;
  RNFS.stopDownload(jobIdRef.current);
}
