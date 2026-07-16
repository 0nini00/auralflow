import { inflate, deflate, inflateRaw, deflateRaw, gzip } from "pako";

/**
 * RN 环境下的 zlib 压缩/解压工具。
 * 桌面端使用 CompressionStream + Tauri 原生 zlib，RN 两者都没有，
 * 这里改用纯 JS 的 pako 实现，API 与桌面端 src/utils/compression.ts 保持一致。
 */

export type ZlibFormat = "deflate" | "deflate-raw" | "gzip";

function toBytes(value: string | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  }
  return new Uint8Array(value);
}

function normalizeFormat(format?: unknown): ZlibFormat {
  if (format === "gzip" || format === "deflate-raw") return format;
  return "deflate";
}

export async function inflateBytes(
  value: string | ArrayBuffer | ArrayBufferView,
  format?: unknown,
): Promise<Uint8Array> {
  const bytes = toBytes(value);
  const resolved = normalizeFormat(format);
  // pako 的 inflate 会自动识别 gzip / zlib 头，因此 deflate 与 gzip 复用同一入口
  if (resolved === "deflate-raw") return inflateRaw(bytes);
  return inflate(bytes);
}

export async function deflateBytes(
  value: string | ArrayBuffer | ArrayBufferView,
  format?: unknown,
): Promise<Uint8Array> {
  const bytes = toBytes(value);
  const resolved = normalizeFormat(format);
  if (resolved === "deflate-raw") return deflateRaw(bytes);
  if (resolved === "gzip") return gzip(bytes);
  return deflate(bytes);
}

export function zlibFormatFromOptions(options?: unknown): ZlibFormat {
  if (typeof options === "string") return normalizeFormat(options);
  if (options && typeof options === "object" && "format" in options) {
    return normalizeFormat((options as { format?: unknown }).format);
  }
  return "deflate";
}
