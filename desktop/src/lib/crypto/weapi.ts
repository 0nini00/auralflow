import CryptoJS from "crypto-js";
import forge from "node-forge";
import {
  encryptWyEapi,
  encryptWyLinuxapi,
  encryptWyWeapi,
  type WyEapiPrimitives,
  type WyWeapiPrimitives,
  type WyWeapiResult,
} from "@lx/core";

/**
 * 网易云加密在桌面端的原语实现（crypto-js + node-forge）。
 *
 * 算法、密钥、公钥都在 `@lx/core/wy-crypto`，这里只回答「AES / RSA / MD5 怎么算」。
 */
const RSA_MODULUS_BYTES = 128;

const utf8 = (text: string) => CryptoJS.enc.Utf8.parse(text);

const primitives: WyWeapiPrimitives & WyEapiPrimitives = {
  aesCbcEncryptBase64(plainText, keyText, ivText) {
    return CryptoJS.AES.encrypt(utf8(plainText), utf8(keyText), {
      iv: utf8(ivText),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    }).toString();
  },

  rsaNoPaddingEncryptHex(text, publicKeyPem) {
    const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
    const padded = "\0".repeat(RSA_MODULUS_BYTES - text.length) + text;
    const message = new forge.jsbn.BigInteger(forge.util.bytesToHex(padded), 16);
    return message.modPow(publicKey.e, publicKey.n).toString(16).padStart(RSA_MODULUS_BYTES * 2, "0");
  },

  md5Hex(text) {
    return CryptoJS.MD5(text).toString();
  },

  aesEcbEncryptHex(plainText, keyText) {
    return CryptoJS.AES.encrypt(utf8(plainText), utf8(keyText), {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    }).ciphertext.toString(CryptoJS.enc.Hex);
  },
};

export function weapi(data: Record<string, unknown>): Promise<WyWeapiResult> {
  return encryptWyWeapi(primitives, data);
}

/** @param path 以 `/api/` 开头的接口路径，参与摘要。返回 `params` 的大写十六进制。 */
export function eapi(path: string, data: Record<string, unknown>): string {
  return encryptWyEapi(primitives, path, data);
}

/** 返回 `/api/linux/forward` 的 `eparams`。 */
export function linuxapi(data: Record<string, unknown>): string {
  return encryptWyLinuxapi(primitives, data);
}
