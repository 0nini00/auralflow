import { NativeModules, Platform } from "react-native";

import { fetchWithTimeout } from "@/utils/fetchWithTimeout";
import { getWyCookie } from "./wyAccountService";
import { postWyWeapi } from "./wyPlaylistService";
import {
  CLOUD_UPLOAD_LBS_URL,
  buildCloudUploadCheckPayload,
  buildCloudUploadCompletePayload,
  buildCloudUploadTokenPayload,
  buildCloudUploadUrl,
} from "@lx/core";

/** 原生文件选择返回的一条音频；size 为字节数。 */
export interface CloudAudioFile {
  uri: string;
  fileName: string;
  mimeType: string;
  size: number;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
}

export type CloudUploadPhase = "hashing" | "checking" | "uploading" | "completing";

export interface CloudUploadCallbacks {
  uploadId: string;
  onPhase: (phase: CloudUploadPhase) => void;
  onProgress: (loaded: number, total: number) => void;
  isCancelled: () => boolean;
}

export interface CloudUploadOutcome {
  songId: string;
  needUpload: boolean;
}

interface CloudUploadNativeModule {
  pickAudioFiles(): Promise<unknown>;
  computeMd5(uri: string): Promise<string>;
  uploadFile(
    uri: string,
    uploadUrl: string,
    token: string,
    md5: string,
    mimeType: string,
    fileSize: number,
    uploadId: string,
  ): Promise<unknown>;
  cancelUpload(uploadId: string): Promise<unknown>;
}

interface WyCloudCheckResponse {
  code?: number;
  msg?: string;
  message?: string;
  needUpload?: boolean;
  songId?: number | string;
}

interface WyNosTokenResponse {
  code?: number;
  message?: string;
  result?: {
    token?: string;
    objectKey?: string;
    resourceId?: string;
  };
}

interface WyCloudInfoResponse {
  code?: number;
  msg?: string;
  message?: string;
  songId?: number | string;
}

interface WyLbsResponse {
  upload?: string[];
}

export class CloudUploadCancelledError extends Error {
  constructor() {
    super("上传已取消");
    this.name = "CloudUploadCancelledError";
  }
}

const nativeModule = NativeModules.CloudUploadModule as CloudUploadNativeModule | undefined;

function requireNativeModule(): CloudUploadNativeModule {
  if (Platform.OS !== "android") {
    throw new Error("云盘上传目前仅支持 Android");
  }
  if (!nativeModule?.pickAudioFiles) {
    throw new Error("云盘上传模块不可用，请安装包含 CloudUploadModule 的新版应用");
  }
  return nativeModule;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizePickedFile(value: unknown): CloudAudioFile {
  if (!value || typeof value !== "object") {
    throw new Error("文件选择器返回了无效条目");
  }
  const record = value as Record<string, unknown>;
  const uri = asString(record.uri);
  const size = asNumber(record.size);
  const fileName = asString(record.fileName) || "未知音频";
  if (!uri || size <= 0) {
    throw new Error(`无法读取音频文件「${fileName}」`);
  }
  return {
    uri,
    fileName,
    mimeType: asString(record.mimeType),
    size,
    title: asString(record.title) || fileName.replace(/\.[^.]+$/, ""),
    artist: asString(record.artist),
    album: asString(record.album),
    durationMs: asNumber(record.durationMs),
  };
}

/** 系统文件选择器：只返回可读、带大小的音频；取消时返回空数组。 */
export async function pickCloudAudioFiles(): Promise<CloudAudioFile[]> {
  const module = requireNativeModule();
  const picked = await module.pickAudioFiles();
  if (!Array.isArray(picked)) return [];
  return picked.map(normalizePickedFile);
}

function throwIfCancelled(callbacks: CloudUploadCallbacks): void {
  if (callbacks.isCancelled()) throw new CloudUploadCancelledError();
}

function responseMessage(body: { msg?: string; message?: string }, fallback: string): string {
  return body.msg || body.message || fallback;
}

async function fetchUploadBase(): Promise<string> {
  const response = await fetchWithTimeout(CLOUD_UPLOAD_LBS_URL, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`获取云盘上传服务器失败（HTTP ${response.status}）`);
  }
  const body = (await response.json()) as WyLbsResponse;
  const base = Array.isArray(body.upload) ? body.upload[0] : undefined;
  if (!base) throw new Error("云盘上传服务器地址无效");
  return base;
}

/**
 * 上传一首音频到网易云云盘。
 *
 * 链路：check -> nos token -> LBS -> 原生流式直传 -> 云盘信息入库 -> 发布。
 * 文件内容不经过 JS 内存，MD5 与上传都由 Android 原生按流处理。
 */
export async function uploadCloudAudio(
  file: CloudAudioFile,
  callbacks: CloudUploadCallbacks,
): Promise<CloudUploadOutcome> {
  const module = requireNativeModule();
  const cookie = await getWyCookie();
  if (!cookie) throw new Error("未登录网易云账号，无法上传到云盘");
  throwIfCancelled(callbacks);

  callbacks.onPhase("hashing");
  const md5 = await module.computeMd5(file.uri);
  if (!/^[a-f0-9]{32}$/i.test(md5)) throw new Error("计算文件 MD5 失败");
  throwIfCancelled(callbacks);

  callbacks.onPhase("checking");
  const check = await postWyWeapi<WyCloudCheckResponse>(
    "/cloud/upload/check",
    buildCloudUploadCheckPayload(file.size, md5),
    cookie,
  );
  if (check.code !== 200) {
    throw new Error(responseMessage(check, "云盘上传检查失败"));
  }
  const songId = asString(check.songId) || String(check.songId ?? "");
  if (!songId) throw new Error("云盘上传检查未返回歌曲 ID");
  throwIfCancelled(callbacks);

  const token = await postWyWeapi<WyNosTokenResponse>(
    "/nos/token/alloc",
    buildCloudUploadTokenPayload(file.fileName, md5),
    cookie,
  );
  const tokenResult = token.result;
  if (token.code !== 200 || !tokenResult?.token || !tokenResult.objectKey || !tokenResult.resourceId) {
    throw new Error(responseMessage(token, "获取云盘上传凭证失败"));
  }
  throwIfCancelled(callbacks);

  // 服务端明确说 true 才传文件；字段缺失时按“无需上传”处理，避免盲目重传大文件。
  const needUpload = check.needUpload === true;
  if (needUpload) {
    const uploadBase = await fetchUploadBase();
    throwIfCancelled(callbacks);
    callbacks.onPhase("uploading");
    await module.uploadFile(
      file.uri,
      buildCloudUploadUrl(uploadBase, tokenResult.objectKey),
      tokenResult.token,
      md5,
      file.mimeType || "application/octet-stream",
      file.size,
      callbacks.uploadId,
    );
    throwIfCancelled(callbacks);
  }

  callbacks.onPhase("completing");
  const info = await postWyWeapi<WyCloudInfoResponse>(
    "/upload/cloud/info/v2",
    buildCloudUploadCompletePayload({
      md5,
      songId,
      fileName: file.fileName,
      title: file.title,
      artist: file.artist || "未知艺术家",
      album: file.album || "未知专辑",
      resourceId: tokenResult.resourceId,
    }),
    cookie,
  );
  if (info.code !== 200) {
    throw new Error(responseMessage(info, "云盘信息写入失败"));
  }
  const finalSongId = asString(info.songId) || songId;
  const published = await postWyWeapi<{ code?: number; message?: string }>(
    "/cloud/pub/v2",
    { songid: finalSongId },
    cookie,
  );
  if (published.code !== 200) {
    throw new Error(responseMessage(published, "云盘歌曲发布失败"));
  }

  return { songId: finalSongId, needUpload };
}

/** 从云盘删除一首歌；只删云端记录，不动本地下载。 */
export async function deleteCloudSong(songId: string): Promise<void> {
  const id = songId.trim();
  if (!id) throw new Error("缺少云盘歌曲 ID");
  const cookie = await getWyCookie();
  if (!cookie) throw new Error("未登录网易云账号，无法删除云盘歌曲");
  const body = await postWyWeapi<{ code?: number; msg?: string; message?: string }>(
    "/cloud/del",
    { songIds: [id] },
    cookie,
  );
  if (body.code !== 200) {
    throw new Error(responseMessage(body, "云盘删除失败"));
  }
}

export async function cancelCloudUpload(uploadId: string): Promise<void> {
  const module = NativeModules.CloudUploadModule as CloudUploadNativeModule | undefined;
  if (!module?.cancelUpload) return;
  await module.cancelUpload(uploadId);
}
