import { NativeModules } from "react-native";
import { base64ToBytes, bytesToBase64 } from "@/utils/base64";
import {
  WY_WEAPI_IV,
  WY_WEAPI_PRESET_KEY,
  WY_WEAPI_PUBLIC_KEY_PEM,
  encryptWyWeapi,
  type WyWeapiPrimitives,
  type WyWeapiResult,
} from "@lx/core";
import { weapi as weapiJsFallback } from "./weapiJs";

const { CryptoModule } = NativeModules as { CryptoModule?: CryptoNative };

interface CryptoNative {
  aesEncrypt(dataB64: string, keyB64: string, ivB64: string): Promise<string>;
  rsaNoPaddingEncrypt(text: string, publicKeyPem: string): Promise<string>;
}

/** 正确的 UTF-8 编码（Hermes 无 TextEncoder，手写；中文 payload 必须） */
const utf8ToBytes = (text: string): Uint8Array => {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
};

const toBase64 = (text: string) => bytesToBase64(utf8ToBytes(text));

/** 把原生模块包成 core 约定的原语：明文、密钥、IV 都按 UTF-8 字节传给 Java Cipher。 */
function nativePrimitives(crypto: CryptoNative): WyWeapiPrimitives {
  return {
    aesCbcEncryptBase64: (plainText, keyText, ivText) =>
      crypto.aesEncrypt(toBase64(plainText), toBase64(keyText), toBase64(ivText)),
    rsaNoPaddingEncryptHex: (text, publicKeyPem) => crypto.rsaNoPaddingEncrypt(text, publicKeyPem),
  };
}

/** 原生固定向量自校验的会话级缓存：一次通过后本次运行不再重复验证 */
let nativeCryptoVerified = false;

/** 原生实现（Android Java Cipher）——lx-netease-music-mobile 同款方案 */
async function weapiNative(data: Record<string, unknown>): Promise<WyWeapiResult> {
  const crypto = CryptoModule;
  if (!crypto) throw new Error("CryptoModule 不可用");
  const primitives = nativePrimitives(crypto);
  const { params, encSecKey } = await encryptWyWeapi(primitives, data);

  // 结构自检（格式层面）
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(params) || params.length % 4 !== 0) {
    throw new Error("原生加密自校验失败：params 非合法 Base64");
  }
  if (base64ToBytes(params).length % 16 !== 0) {
    throw new Error("原生加密自校验失败：params 密文长度非 16 字节倍数");
  }
  if (!/^[0-9a-f]{256}$/.test(encSecKey)) {
    throw new Error("原生加密自校验失败：encSecKey 非 256 位十六进制");
  }
  // 固定向量自检（正确性层面，会话内只做一次）
  if (!nativeCryptoVerified) {
    await verifyWeapiNativeResult(primitives);
    nativeCryptoVerified = true;
  }

  return { params, encSecKey };
}

/**
 * 原生结果自校验（真机防线）：原生 CryptoModule 若产出错误密文但不抛错，
 * weapi() 会静默把坏密文发给网易，登录 301/空响应且无从排查。
 * 校验两层：
 *  1. 结构校验：params 是合法 Base64 且 16 字节对齐、encSecKey 是 256 位十六进制；
 *  2. 固定向量校验：用 Node 预计算的已知正确密文（两轮 AES + RSA NoPadding）
 *     走原生模块复算比对——NoPadding RSA 与 AES 均为确定性加密，Java 侧任何
 *     填充/字节序/密钥解析/S 盒错误都会逐位暴露。
 * 任一失败抛错，weapi() 捕获后自动回退 JS 实现（weapiJs），保证登录链路可用。
 */
async function verifyWeapiNativeResult(primitives: WyWeapiPrimitives): Promise<void> {
  const fail = (reason: string): never => {
    throw new Error(`原生加密自校验失败：${reason}`);
  };

  // 固定向量校验：不依赖 crypto-js/node-forge（Hermes 上不可靠），用 Node
  // 预计算的已知正确密文做一次端到端验证。三个向量覆盖 两轮 AES + RSA NoPadding，
  // 任何 Java 侧填充/字节序/密钥解析/S盒错误都会导致逐位不一致。
  const v1 = await verifyAesVector(
    primitives,
    JSON.stringify({ csrf_token: "abc123" }),
    WY_WEAPI_PRESET_KEY,
    "aKS4n8TKtbcDkXwuvGwgv0PE9lKZ7+SQXQ993eEDqFc="
  );
  if (!v1) fail("第一次 AES 固定向量不匹配");
  const v2 = await verifyAesVector(
    primitives,
    "aKS4n8TKtbcDkXwuvGwgv0PE9lKZ7+SQXQ993eEDqFc=",
    "JmX8r2LpQ4vZ9wKs",
    "yCi0k0x3OAKsbWpu8W53QG98Tmt7iyRYqX3tmDRizbiFLKQXKBr4cLI7vimiBwD5"
  );
  if (!v2) fail("第二次 AES 固定向量不匹配");
  const v3 = await verifyRsaVector(
    primitives,
    "sKw9ZvQ4pL2rXm8J".split("").reverse().join(""),
    "d1b862365229f275df0f5df0a4a9a3fc946687cf72862e656960df1363b1cd691128b762c58e26000a6f24cdc1de9848015f41d1f47f8478d93a6629b3b1958288cf37272a2a5af06d5b863eba0441a3debd5be7b0e70991fa10f7f21c93b85d91e60b44d7ba7844671a8da7b58b366e4d7570403c658d6b0b3d20c13e6cd9c0"
  );
  if (!v3) fail("RSA NoPadding 固定向量不匹配");
}

/** 用原生原语加密已知输入，比对 Node 预计算的期望密文（Base64）。 */
async function verifyAesVector(
  primitives: WyWeapiPrimitives,
  plainText: string,
  keyText: string,
  expectedB64: string,
): Promise<boolean> {
  return (await primitives.aesCbcEncryptBase64(plainText, keyText, WY_WEAPI_IV)) === expectedB64;
}

/** 用原生原语加密已知输入（RSA NoPadding），比对预计算的期望十六进制。 */
async function verifyRsaVector(primitives: WyWeapiPrimitives, input: string, expectedHex: string): Promise<boolean> {
  return (await primitives.rsaNoPaddingEncryptHex(input, WY_WEAPI_PUBLIC_KEY_PEM)) === expectedHex;
}

/**
 * 网易云 weapi 加密（原生优先， JS 兜底）。
 * weapi 走原生 CryptoModule；
 * crypto-js/node-forge 在 Hermes 上不可靠，仅作原生不可用时的兜底。
 */
export async function weapi(data: Record<string, unknown>): Promise<WyWeapiResult> {
  if (CryptoModule) {
    try {
      return await weapiNative(data);
    } catch (error) {
      // 原生失败（含自校验不过）时回退 JS 实现（见 weapiJs.ts）
      console.warn("[weapi] 原生加密不可用，回退 JS：", error instanceof Error ? error.message : String(error));
    }
  }
  return weapiJsFallback(data);
}
