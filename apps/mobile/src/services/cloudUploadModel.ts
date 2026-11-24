/**
 * 网易云云盘上传的协议常量与纯参数构造。
 *
 * 这些字段是服务端契约的一部分，集中在这里便于单测锁定；网络与原生文件读取
 * 分别由 cloudUploadService 和 Android CloudUploadModule 负责。
 */

export const CLOUD_UPLOAD_BUCKET = "jd-musicrep-privatecloud-audio-public";
/** 云盘不按档位转码，客户端统一报这个占位码率（对齐参考实现）。 */
export const CLOUD_UPLOAD_BITRATE = "999000";
export const CLOUD_UPLOAD_LBS_URL =
  `https://wanproxy.127.net/lbs?version=1.0&bucketname=${CLOUD_UPLOAD_BUCKET}`;

export interface CloudUploadCheckPayload {
  [key: string]: unknown;
  bitrate: string;
  ext: string;
  length: number;
  md5: string;
  songId: string;
  version: number;
}

export interface CloudUploadTokenPayload {
  [key: string]: unknown;
  bucket: string;
  ext: string;
  filename: string;
  local: boolean;
  nos_product: number;
  type: "audio";
  md5: string;
}

export interface CloudUploadCompletePayload {
  [key: string]: unknown;
  md5: string;
  songid: string;
  filename: string;
  song: string;
  album: string;
  artist: string;
  bitrate: string;
  resourceId: string;
}

/** 取小写扩展名；没有扩展名时沿用参考实现的 mp3 兜底。 */
export function cloudUploadFileExtension(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "mp3";
}

/**
 * NOS 的 objectKey 文件名：去掉扩展名、空白和点。
 * 中文与其他可见字符原样保留，和参考实现一致。
 */
export function cloudUploadTokenFileName(fileName: string): string {
  const withoutExtension = fileName.trim().replace(/\.[^.]+$/, "");
  const sanitized = withoutExtension.replace(/\s/g, "").replace(/\./g, "_");
  return sanitized || "audio";
}

/** 参考实现只转义 objectKey 中的 `/`，其余字符保持原样。 */
export function buildCloudUploadUrl(uploadBase: string, objectKey: string): string {
  const base = uploadBase.replace(/\/+$/, "");
  return `${base}/${CLOUD_UPLOAD_BUCKET}/${objectKey.replace(/\//g, "%2F")}?offset=0&complete=true&version=1.0`;
}

export function buildCloudUploadCheckPayload(fileSize: number, md5: string): CloudUploadCheckPayload {
  return {
    bitrate: CLOUD_UPLOAD_BITRATE,
    ext: "",
    length: fileSize,
    md5,
    songId: "0",
    version: 1,
  };
}

export function buildCloudUploadTokenPayload(
  fileName: string,
  md5: string,
): CloudUploadTokenPayload {
  return {
    bucket: CLOUD_UPLOAD_BUCKET,
    ext: cloudUploadFileExtension(fileName),
    filename: cloudUploadTokenFileName(fileName),
    local: false,
    nos_product: 3,
    type: "audio",
    md5,
  };
}

export function buildCloudUploadCompletePayload(input: {
  md5: string;
  songId: string;
  fileName: string;
  title: string;
  artist: string;
  album: string;
  resourceId: string;
}): CloudUploadCompletePayload {
  return {
    md5: input.md5,
    songid: input.songId,
    filename: input.fileName,
    song: input.title,
    album: input.album,
    artist: input.artist,
    bitrate: CLOUD_UPLOAD_BITRATE,
    resourceId: input.resourceId,
  };
}
