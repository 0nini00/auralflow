import CryptoJS from "crypto-js";
import forge from "node-forge";

const WY_IV = CryptoJS.enc.Utf8.parse("0102030405060708");
const WY_PRESET_KEY = CryptoJS.enc.Utf8.parse("0CoJUm6Qyw8W8jud");
const WY_EAPI_KEY = CryptoJS.enc.Utf8.parse("e82ckenh8dichen8");

const BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randSecretKey(length = 16): string {
  let key = "";
  for (let i = 0; i < length; i++) {
    key += BASE62[Math.floor(Math.random() * BASE62.length)];
  }
  return key;
}

const WY_PUBLIC_KEY =
  "-----BEGIN PUBLIC KEY-----\n" +
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n" +
  "-----END PUBLIC KEY-----";

function rsaNoPaddingEncrypt(input: string): string {
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
  const text = JSON.stringify(data);
  const secretKeyStr = randSecretKey(16);
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

export function eapi(path: string, data: Record<string, any>): {
  params: string;
} {
  const text = typeof data === "object" ? JSON.stringify(data) : String(data);
  const message = `nobody${path}use${text}md5forencrypt`;
  const digest = CryptoJS.MD5(message).toString();
  const payload = `${path}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(payload),
    WY_EAPI_KEY,
    {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    }
  );

  return {
    params: encrypted.ciphertext.toString().toUpperCase(),
  };
}
