/**
 * 网易云三套请求加密（weapi / eapi / linuxapi）的算法定义。
 *
 * 这里只写「怎么拼、按什么顺序加密」，不写「怎么算 AES / RSA / MD5」：
 * core 不带任何加密库依赖，原语由两端注入。桌面端用 crypto-js + node-forge；
 * 移动端的 weapi 走原生 CryptoModule（Hermes 上 JS 加密库可能产出错误密文），
 * eapi 仍用 crypto-js。算法、密钥、公钥此前在两端共有三份，改一处漏一处就是
 * 「同一个账号一端能登录另一端 301」。
 */

/** weapi 需要的原语。两个都允许异步：移动端的原生模块只有 Promise 接口。 */
export interface WyWeapiPrimitives {
  /** AES-128-CBC + PKCS7。明文、密钥、IV 都按 UTF-8 取字节，返回 Base64 密文。 */
  aesCbcEncryptBase64(plainText: string, keyText: string, ivText: string): string | Promise<string>;
  /** RSA 无填充加密（输入左侧补零到模长），返回 256 位小写十六进制。 */
  rsaNoPaddingEncryptHex(text: string, publicKeyPem: string): string | Promise<string>;
}

/** eapi / linuxapi 需要的原语。 */
export interface WyEapiPrimitives {
  /** MD5，返回小写十六进制。 */
  md5Hex(text: string): string;
  /** AES-128-ECB + PKCS7。明文与密钥按 UTF-8 取字节，返回十六进制密文（大小写不限）。 */
  aesEcbEncryptHex(plainText: string, keyText: string): string;
}

export const WY_WEAPI_PRESET_KEY = "0CoJUm6Qyw8W8jud";
export const WY_WEAPI_IV = "0102030405060708";
export const WY_EAPI_KEY = "e82ckenh8dichen8";
export const WY_LINUXAPI_KEY = "rFgB&h#%2?^eDg:Q";
export const WY_WEAPI_PUBLIC_KEY_PEM =
  "-----BEGIN PUBLIC KEY-----\n" +
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n" +
  "-----END PUBLIC KEY-----";

const WEAPI_SECRET_KEY_LENGTH = 16;
const BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/** eapi 把 path、正文、摘要拼成一条报文时用的分隔符，服务端按它拆分。 */
const EAPI_FIELD_SEPARATOR = "-36cd479b6b5-";

export interface WyWeapiResult {
  params: string;
  encSecKey: string;
}

/** weapi 的一次性会话密钥：16 位 base62。只用于包住本次请求，不需要密码学强度。 */
export function randomWyWeapiSecretKey(): string {
  let key = "";
  for (let i = 0; i < WEAPI_SECRET_KEY_LENGTH; i += 1) {
    key += BASE62[Math.floor(Math.random() * BASE62.length)];
  }
  return key;
}

/**
 * weapi 加密：正文先用固定密钥 AES 一次，再用会话密钥 AES 一次；会话密钥倒序后
 * 经 RSA 无填充加密作为 `encSecKey`。
 *
 * 第二轮加密的输入是第一轮结果的 **Base64 文本**，不是解码后的密文字节。
 * `secretKey` 仅为测试注入固定向量而开放，生产调用不要传。
 */
export async function encryptWyWeapi(
  primitives: WyWeapiPrimitives,
  data: Record<string, unknown>,
  secretKey: string = randomWyWeapiSecretKey(),
): Promise<WyWeapiResult> {
  if (secretKey.length !== WEAPI_SECRET_KEY_LENGTH) {
    throw new Error(`weapi 会话密钥必须是 ${WEAPI_SECRET_KEY_LENGTH} 位`);
  }
  const firstRound = await primitives.aesCbcEncryptBase64(JSON.stringify(data), WY_WEAPI_PRESET_KEY, WY_WEAPI_IV);
  const params = await primitives.aesCbcEncryptBase64(firstRound, secretKey, WY_WEAPI_IV);
  const reversedKey = secretKey.split("").reverse().join("");
  const encSecKey = await primitives.rsaNoPaddingEncryptHex(reversedKey, WY_WEAPI_PUBLIC_KEY_PEM);
  return { params, encSecKey };
}

/**
 * eapi 加密，返回大写十六进制的 `params`。
 * @param path 以 `/api/` 开头的接口路径；它参与摘要，必须与实际请求的接口一致。
 */
export function encryptWyEapi(
  primitives: WyEapiPrimitives,
  path: string,
  data: Record<string, unknown>,
): string {
  const text = JSON.stringify(data);
  const digest = primitives.md5Hex(`nobody${path}use${text}md5forencrypt`);
  const message = [path, text, digest].join(EAPI_FIELD_SEPARATOR);
  return primitives.aesEcbEncryptHex(message, WY_EAPI_KEY).toUpperCase();
}

/** linuxapi 加密（`/api/linux/forward` 的 `eparams`），返回大写十六进制。 */
export function encryptWyLinuxapi(primitives: WyEapiPrimitives, data: Record<string, unknown>): string {
  return primitives.aesEcbEncryptHex(JSON.stringify(data), WY_LINUXAPI_KEY).toUpperCase();
}
