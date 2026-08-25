import CryptoJS from "crypto-js";
import forge from "node-forge";

const WY_IV = CryptoJS.enc.Utf8.parse("0102030405060708");
const WY_PRESET_KEY = CryptoJS.enc.Utf8.parse("0CoJUm6Qyw8W8jud");

/**
 * 网易云 weapi 加密——JS 兜底实现（crypto-js + node-forge，原 weapi.ts 内容）。
 *
 * Hermes 上 crypto-js/node-forge 可能产出错误密文（Node oracle 通过不代表
 * Hermes 运行时正确），正式路径走原生 CryptoModule（见 weapi.ts），
 * 本文件仅兜底。
 */
function randSecretKey(length = 16): string {
  let key = "";
  const BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (let i = 0; i < length; i += 1) {
    key += BASE62[Math.floor(Math.random() * BASE62.length)];
  }
  return key;
}

function rsaNoPaddingEncrypt(input: string): string {
  const WY_PUBLIC_KEY =
    "-----BEGIN PUBLIC KEY-----\n" +
    "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n" +
    "-----END PUBLIC KEY-----";
  const publicKey = forge.pki.publicKeyFromPem(WY_PUBLIC_KEY);
  const padded = "\0".repeat(128 - input.length) + input;
  const msgHex = forge.util.bytesToHex(padded);
  const m = new forge.jsbn.BigInteger(msgHex, 16);
  const c = m.modPow(publicKey.e, publicKey.n);
  return c.toString(16).padStart(256, "0");
}

export function weapi(data: Record<string, any>): {
  params: string;
  encSecKey: string;
} {
  const secretKeyStr = randSecretKey(16);
  const text = JSON.stringify(data);
  const secretKey = CryptoJS.enc.Utf8.parse(secretKeyStr);

  const encryptedOnce = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(text),
    WY_PRESET_KEY,
    {
      iv: WY_IV,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    }
  ).toString();

  const params = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(encryptedOnce),
    secretKey,
    {
      iv: WY_IV,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    }
  ).toString();

  const encSecKey = rsaNoPaddingEncrypt(
    secretKeyStr.split("").reverse().join("")
  );

  return { params, encSecKey };
}
