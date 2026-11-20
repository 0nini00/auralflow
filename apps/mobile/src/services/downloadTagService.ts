import { NativeModules } from "react-native";

interface DownloadTagMetadata {
  title?: string;
  artist?: string;
  album?: string;
  lyrics?: string;
}

interface DownloadTagNativeModule {
  writeMp3Tags(audioFilePath: string, metadata: DownloadTagMetadata, coverPath: string | null): Promise<void>;
}

/** 音频始终留在原生文件系统；JS 只传递标签文本和临时封面路径。 */
export async function writeDownloadedMp3Tags(
  audioFilePath: string,
  metadata: DownloadTagMetadata,
  coverPath: string | null,
): Promise<void> {
  const native = NativeModules.DownloadTagModule as DownloadTagNativeModule | undefined;
  if (!native) throw new Error("下载标签模块不可用，请安装包含 DownloadTagModule 的新版应用");
  await native.writeMp3Tags(audioFilePath, metadata, coverPath);
}
