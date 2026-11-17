const assert = require("node:assert/strict");
const test = require("node:test");
const nodeCrypto = require("node:crypto");
const { createLoader, mobileRequire } = require("./helpers/loadTs.cjs");

/**
 * weapi 的三条路径必须产出同一份密文：core 的算法 + 原生原语、core 的算法 + JS 原语、
 * 以及原生自校验失败后的回退。固定向量与 `weapi.ts` 的会话自校验是同一组。
 */
const SECRET_FOR_PARAMS = "JmX8r2LpQ4vZ9wKs";
const EXPECTED_PARAMS = "yCi0k0x3OAKsbWpu8W53QG98Tmt7iyRYqX3tmDRizbiFLKQXKBr4cLI7vimiBwD5";
const SECRET_FOR_RSA = "sKw9ZvQ4pL2rXm8J";
const EXPECTED_ENC_SEC_KEY =
  "d1b862365229f275df0f5df0a4a9a3fc946687cf72862e656960df1363b1cd691128b762c58e26000a6f24cdc1de9848015f41d1f47f8478d93a6629b3b1958288cf37272a2a5af06d5b863eba0441a3debd5be7b0e70991fa10f7f21c93b85d91e60b44d7ba7844671a8da7b58b366e4d7570403c658d6b0b3d20c13e6cd9c0";
const BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const RSA_MODULUS_BYTES = 128;

/** 让 Math.random 依次吐出能拼成指定会话密钥的值，用完即还原。 */
async function withSecretKey(secretKey, run) {
  const original = Math.random;
  const queue = [...secretKey].map((char) => (BASE62.indexOf(char) + 0.5) / BASE62.length);
  Math.random = () => {
    assert.ok(queue.length > 0, "会话密钥之外不应再取随机数");
    return queue.shift();
  };
  try {
    return await run();
  } finally {
    Math.random = original;
  }
}

/** 与 Android CryptoModule 同契约的参照实现：入参是 Base64 字节，AES 返回 Base64，RSA 返回十六进制。 */
function createNativeCrypto({ corruptAes = false } = {}) {
  const calls = { aes: 0, rsa: 0 };
  return {
    calls,
    module: {
      async aesEncrypt(dataB64, keyB64, ivB64) {
        calls.aes += 1;
        const cipher = nodeCrypto.createCipheriv(
          "aes-128-cbc",
          Buffer.from(keyB64, "base64"),
          Buffer.from(ivB64, "base64"),
        );
        const encrypted = Buffer.concat([cipher.update(Buffer.from(dataB64, "base64")), cipher.final()]);
        if (corruptAes) encrypted[0] ^= 0xff;
        return encrypted.toString("base64");
      },
      async rsaNoPaddingEncrypt(text, publicKeyPem) {
        calls.rsa += 1;
        const padded = Buffer.alloc(RSA_MODULUS_BYTES);
        Buffer.from(text, "latin1").copy(padded, RSA_MODULUS_BYTES - text.length);
        return nodeCrypto
          .publicEncrypt({ key: publicKeyPem, padding: nodeCrypto.constants.RSA_NO_PADDING }, padded)
          .toString("hex");
      },
    },
  };
}

function loadWeapi(cryptoModule, jsFallback) {
  const load = createLoader({
    "react-native": { NativeModules: cryptoModule ? { CryptoModule: cryptoModule } : {} },
    "./weapiJs": { weapi: jsFallback },
  });
  return load("src/services/weapi.ts");
}

function loadWeapiJs() {
  const load = createLoader({
    "crypto-js": mobileRequire("crypto-js"),
    "node-forge": mobileRequire("node-forge"),
  });
  return load("src/services/weapiJs.ts");
}

test("原生路径：密文等于固定向量，且会话内只自校验一次", async () => {
  const native = createNativeCrypto();
  const { weapi } = loadWeapi(native.module, async () => assert.fail("原生可用时不得走 JS 兜底"));

  const first = await withSecretKey(SECRET_FOR_PARAMS, () => weapi({ csrf_token: "abc123" }));
  assert.equal(first.params, EXPECTED_PARAMS);
  // 一次加密：2 轮 AES + 1 次 RSA；首次另加自校验的 2 轮 AES + 1 次 RSA。
  assert.deepEqual(native.calls, { aes: 4, rsa: 2 });

  const second = await withSecretKey(SECRET_FOR_RSA, () => weapi({}));
  assert.equal(second.encSecKey, EXPECTED_ENC_SEC_KEY);
  assert.deepEqual(native.calls, { aes: 6, rsa: 3 });
});

test("原生产出错误密文时自校验拦下，改用 JS 兜底", async () => {
  const native = createNativeCrypto({ corruptAes: true });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const { weapi } = loadWeapi(native.module, async () => ({ params: "from-js", encSecKey: "from-js" }));
    assert.deepEqual(await weapi({ csrf_token: "abc123" }), { params: "from-js", encSecKey: "from-js" });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /固定向量不匹配/);
});

test("没有原生模块时直接走 JS 兜底", async () => {
  const { weapi } = loadWeapi(null, async (data) => ({ params: JSON.stringify(data), encSecKey: "js" }));
  assert.deepEqual(await weapi({ a: 1 }), { params: '{"a":1}', encSecKey: "js" });
});

test("JS 兜底（crypto-js + node-forge）与固定向量逐位一致", async () => {
  const { weapi } = loadWeapiJs();

  const first = await withSecretKey(SECRET_FOR_PARAMS, () => weapi({ csrf_token: "abc123" }));
  assert.equal(first.params, EXPECTED_PARAMS);

  const second = await withSecretKey(SECRET_FOR_RSA, () => weapi({}));
  assert.equal(second.encSecKey, EXPECTED_ENC_SEC_KEY);
});
