import CryptoJS from "crypto-js";
import forge from "node-forge";
import { encryptWyWeapi, type WyWeapiPrimitives, type WyWeapiResult } from "@lx/core";

/**
 * 网易云 weapi 的 JS 原语（crypto-js + node-forge），仅在原生 CryptoModule
 * 不可用或自校验不过时兜底。
 *
 * Hermes 上 crypto-js/node-forge 可能产出错误密文（Node oracle 通过不代表
 * Hermes 运行时正确），正式路径走原生 CryptoModule（见 weapi.ts）。
 * 算法、密钥、公钥在 `@lx/core/wy-crypto`，这里只提供原语。
 */
const RSA_MODULUS_BYTES = 128;

const utf8 = (text: string) => CryptoJS.enc.Utf8.parse(text);

const jsPrimitives: WyWeapiPrimitives = {
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
};

export function weapi(data: Record<string, unknown>): Promise<WyWeapiResult> {
  return encryptWyWeapi(jsPrimitives, data);
}
