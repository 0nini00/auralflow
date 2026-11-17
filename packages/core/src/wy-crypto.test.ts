import { constants, createCipheriv, createDecipheriv, createHash, publicEncrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WY_EAPI_KEY,
  WY_LINUXAPI_KEY,
  WY_WEAPI_PUBLIC_KEY_PEM,
  encryptWyEapi,
  encryptWyLinuxapi,
  encryptWyWeapi,
  randomWyWeapiSecretKey,
  type WyEapiPrimitives,
  type WyWeapiPrimitives,
} from "./wy-crypto";

/**
 * 用 Node 自带的 crypto 充当参照实现：它与两端各自注入的原语（crypto-js、
 * node-forge、Android Cipher）互相独立，算法拼错了不会被同一个库的同一个错误掩盖。
 */
const RSA_MODULUS_BYTES = 128;

const nodeWeapi: WyWeapiPrimitives = {
  aesCbcEncryptBase64(plainText, keyText, ivText) {
    const cipher = createCipheriv("aes-128-cbc", Buffer.from(keyText, "utf8"), Buffer.from(ivText, "utf8"));
    return Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]).toString("base64");
  },
  rsaNoPaddingEncryptHex(text, publicKeyPem) {
    const padded = Buffer.alloc(RSA_MODULUS_BYTES);
    Buffer.from(text, "latin1").copy(padded, RSA_MODULUS_BYTES - text.length);
    return publicEncrypt({ key: publicKeyPem, padding: constants.RSA_NO_PADDING }, padded).toString("hex");
  },
};

const nodeEapi: WyEapiPrimitives = {
  md5Hex: (text) => createHash("md5").update(text, "utf8").digest("hex"),
  aesEcbEncryptHex(plainText, keyText) {
    const cipher = createCipheriv("aes-128-ecb", Buffer.from(keyText, "utf8"), null);
    return Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]).toString("hex");
  },
};

function decryptEcbHex(hex: string, keyText: string): string {
  const decipher = createDecipheriv("aes-128-ecb", Buffer.from(keyText, "utf8"), null);
  return Buffer.concat([decipher.update(Buffer.from(hex, "hex")), decipher.final()]).toString("utf8");
}

describe("weapi 加密", () => {
  // 固定向量与移动端原生 CryptoModule 的自校验向量是同一组：三处实现必须逐位一致。
  it("两轮 AES 的结果等于已知密文", async () => {
    const { params } = await encryptWyWeapi(nodeWeapi, { csrf_token: "abc123" }, "JmX8r2LpQ4vZ9wKs");
    expect(params).toBe("yCi0k0x3OAKsbWpu8W53QG98Tmt7iyRYqX3tmDRizbiFLKQXKBr4cLI7vimiBwD5");
  });

  it("encSecKey 是会话密钥倒序后的 RSA 无填充密文", async () => {
    const { encSecKey } = await encryptWyWeapi(nodeWeapi, {}, "sKw9ZvQ4pL2rXm8J");
    expect(encSecKey).toBe(
      "d1b862365229f275df0f5df0a4a9a3fc946687cf72862e656960df1363b1cd691128b762c58e26000a6f24cdc1de9848015f41d1f47f8478d93a6629b3b1958288cf37272a2a5af06d5b863eba0441a3debd5be7b0e70991fa10f7f21c93b85d91e60b44d7ba7844671a8da7b58b366e4d7570403c658d6b0b3d20c13e6cd9c0",
    );
  });

  it("第二轮加密的是第一轮的 Base64 文本，公钥来自 core 的唯一定义", async () => {
    const calls: Array<{ plainText: string; keyText: string }> = [];
    const pems: string[] = [];
    const recording: WyWeapiPrimitives = {
      aesCbcEncryptBase64(plainText, keyText) {
        calls.push({ plainText, keyText });
        return `cipher${calls.length}`;
      },
      async rsaNoPaddingEncryptHex(text, pem) {
        pems.push(pem);
        return text;
      },
    };
    const result = await encryptWyWeapi(recording, { a: 1 }, "0123456789abcdef");
    expect(calls[0].plainText).toBe('{"a":1}');
    expect(calls[1]).toEqual({ plainText: "cipher1", keyText: "0123456789abcdef" });
    expect(result).toEqual({ params: "cipher2", encSecKey: "fedcba9876543210" });
    expect(pems).toEqual([WY_WEAPI_PUBLIC_KEY_PEM]);
  });

  it("会话密钥是 16 位 base62，长度不对直接拒绝", async () => {
    expect(randomWyWeapiSecretKey()).toMatch(/^[A-Za-z0-9]{16}$/);
    await expect(encryptWyWeapi(nodeWeapi, {}, "short")).rejects.toThrow("16 位");
  });
});

describe("eapi 加密", () => {
  it("报文是 path、正文、摘要三段，摘要覆盖 path 与正文", () => {
    const path = "/api/song/enhance/player/url";
    const data = { ids: "[1]", br: 320000 };
    const params = encryptWyEapi(nodeEapi, path, data);
    expect(params).toMatch(/^[0-9A-F]+$/);

    const [gotPath, gotText, gotDigest] = decryptEcbHex(params, WY_EAPI_KEY).split("-36cd479b6b5-");
    expect(gotPath).toBe(path);
    expect(JSON.parse(gotText)).toEqual(data);
    expect(gotDigest).toBe(nodeEapi.md5Hex(`nobody${path}use${gotText}md5forencrypt`));
  });

  it("原语返回小写十六进制时仍输出大写", () => {
    const lower: WyEapiPrimitives = { md5Hex: () => "d", aesEcbEncryptHex: () => "abcdef" };
    expect(encryptWyEapi(lower, "/api/x", {})).toBe("ABCDEF");
  });
});

describe("linuxapi 加密", () => {
  it("整段 JSON 用 linuxapi 密钥做 ECB，输出大写十六进制", () => {
    const data = { method: "POST", url: "https://music.163.com/api/v3/playlist/detail", params: { id: 1 } };
    const eparams = encryptWyLinuxapi(nodeEapi, data);
    expect(eparams).toMatch(/^[0-9A-F]+$/);
    expect(JSON.parse(decryptEcbHex(eparams, WY_LINUXAPI_KEY))).toEqual(data);
  });
});
