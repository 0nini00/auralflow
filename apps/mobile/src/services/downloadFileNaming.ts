import type { MusicInfo } from "@lx/core";

/**
 * 下载文件名构造。
 *
 * 单独成模块是为了能被单测直接覆盖：文件名里带着**远端可控**的歌曲 id，
 * 一旦清洗规则漏了（历史上的 `wy-../x-320k`），写入就会越出下载目录。
 */

/** 把任意远端标识压成单个安全的路径片段。 */
export function fileSegment(value: string): string {
  const cleaned = String(value ?? "")
    // 只留文件名安全字符：/ \ : * ? " < > | 以及控制字符全部替换
    .replace(/[^A-Za-z0-9._-]/g, "_")
    // 连续下划线折叠，避免 base64 尾巴的 "==" 变成一长串
    .replace(/_+/g, "_")
    // 开头的点会导致 `..` / 隐藏文件，统一压成下划线
    .replace(/^[._]+/, "_");
  return cleaned || "_";
}

/**
 * 文件名主干：`source-id-quality`。
 *
 * JOOX 等平台的 id 是 base64（可含 `/`、`+`、`=`），网关数据异常时甚至可能是
 * `../..`。所有「按文件名反查 / 删除」的地方都必须走这个函数，
 * 否则下载完成后会找不到自己的文件。
 *
 * 云盘曲没有「下载档位」：请求哪档都返回同一份上传文件，用 `original` 占位，
 * 避免文件名里写着一个用户根本没选、也不是文件真实码率的档位。
 */
export function buildDownloadFileStem(
  song: Pick<MusicInfo, "source" | "id" | "wyCloud">,
  quality: string,
): string {
  const qualityKey = song.wyCloud === true ? "original" : quality;
  return `${fileSegment(song.source)}-${fileSegment(song.id)}-${fileSegment(qualityKey)}`;
}
