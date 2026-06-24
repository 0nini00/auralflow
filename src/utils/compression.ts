import { invoke } from "@tauri-apps/api/core";

type ZlibFormat = "deflate" | "deflate-raw" | "gzip";

function toBytes(value: string | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  return new Uint8Array(value);
}

async function readStreamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function normalizeFormat(format?: unknown): ZlibFormat {
  if (format === "gzip" || format === "deflate-raw") return format;
  return "deflate";
}

function combineCompressionErrors(action: string, webError: unknown, nativeError: unknown): Error {
  const webMessage = webError instanceof Error ? webError.message : String(webError);
  const nativeMessage = nativeError instanceof Error ? nativeError.message : String(nativeError);
  return new Error(`${action}失败：Web API 不可用或处理失败：${webMessage}\nTauri zlib fallback 失败：${nativeMessage}`);
}

async function runWebCompression(
  action: "inflate" | "deflate",
  bytes: Uint8Array,
  format: ZlibFormat,
): Promise<Uint8Array> {
  if (action === "inflate") {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("当前环境缺少 DecompressionStream");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return readStreamBytes(stream);
  }

  if (typeof CompressionStream === "undefined") {
    throw new Error("当前环境缺少 CompressionStream");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(format));
  return readStreamBytes(stream);
}

async function runNativeZlib(command: "zlib_inflate" | "zlib_deflate", bytes: Uint8Array, format: ZlibFormat): Promise<Uint8Array> {
  const result = await invoke<number[]>(command, {
    data: Array.from(bytes),
    format,
  });
  return new Uint8Array(result);
}

export async function inflateBytes(
  value: string | ArrayBuffer | ArrayBufferView,
  format?: unknown,
): Promise<Uint8Array> {
  const bytes = toBytes(value);
  const resolvedFormat = normalizeFormat(format);
  try {
    return await runWebCompression("inflate", bytes, resolvedFormat);
  } catch (webError) {
    try {
      return await runNativeZlib("zlib_inflate", bytes, resolvedFormat);
    } catch (nativeError) {
      throw combineCompressionErrors("解压", webError, nativeError);
    }
  }
}

export async function deflateBytes(
  value: string | ArrayBuffer | ArrayBufferView,
  format?: unknown,
): Promise<Uint8Array> {
  const bytes = toBytes(value);
  const resolvedFormat = normalizeFormat(format);
  try {
    return await runWebCompression("deflate", bytes, resolvedFormat);
  } catch (webError) {
    try {
      return await runNativeZlib("zlib_deflate", bytes, resolvedFormat);
    } catch (nativeError) {
      throw combineCompressionErrors("压缩", webError, nativeError);
    }
  }
}

export function zlibFormatFromOptions(options?: unknown): ZlibFormat {
  if (typeof options === "string") return normalizeFormat(options);
  if (options && typeof options === "object" && "format" in options) {
    return normalizeFormat((options as { format?: unknown }).format);
  }
  return "deflate";
}
