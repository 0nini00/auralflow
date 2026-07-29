/**
 * RN (Hermes) 不保证提供全局 atob/btoa，这里提供纯 JS 实现，
 * 供自定义音源运行时的 crypto/buffer 工具使用。
 */

const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64ToBytes(input: string): Uint8Array {
  // 去除空白与换行，兼容脚本里可能带换行的 base64
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, "");
  if (!clean.length) return new Uint8Array(0);

  const lookup = new Int32Array(256).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i += 1) {
    lookup[B64_CHARS.charCodeAt(i)] = i;
  }
  lookup[61] = 0; // '=' 占位

  const length = clean.length;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const outLength = (length >> 2) * 3 - padding;
  const bytes = new Uint8Array(outLength);

  let index = 0;
  for (let i = 0; i < length; i += 4) {
    const c0 = lookup[clean.charCodeAt(i)];
    const c1 = lookup[clean.charCodeAt(i + 1)];
    const c2 = lookup[clean.charCodeAt(i + 2)];
    const c3 = lookup[clean.charCodeAt(i + 3)];
    const triplet = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (index < outLength) bytes[index++] = (triplet >> 16) & 0xff;
    if (index < outLength) bytes[index++] = (triplet >> 8) & 0xff;
    if (index < outLength) bytes[index++] = triplet & 0xff;
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  let i = 0;
  const length = bytes.length;
  while (i < length) {
    const b0 = bytes[i++] ?? 0;
    const b1 = i < length ? bytes[i++] : -1;
    const b2 = i < length ? bytes[i++] : -1;

    const triplet = (b0 << 16) | ((b1 & 0xff) << 8) | (b2 & 0xff);

    result += B64_CHARS.charAt((triplet >> 18) & 0x3f);
    result += B64_CHARS.charAt((triplet >> 12) & 0x3f);
    result += b1 < 0 ? "=" : B64_CHARS.charAt((triplet >> 6) & 0x3f);
    result += b2 < 0 ? "=" : B64_CHARS.charAt(triplet & 0x3f);
  }
  return result;
}

/** 优先使用全局 atob（若可用），否则回退到纯 JS 实现 */
export function atobSafe(input: string): string {
  if (typeof atob === "function") return atob(input);
  const bytes = base64ToBytes(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return binary;
}

/** 优先使用全局 btoa（若可用），否则回退到纯 JS 实现 */
export function btoaSafe(binary: string): string {
  if (typeof btoa === "function") return btoa(binary);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytesToBase64(bytes);
}
