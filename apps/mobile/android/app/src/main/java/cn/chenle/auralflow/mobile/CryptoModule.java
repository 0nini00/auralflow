package cn.chenle.auralflow.mobile;

import android.util.Base64;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 网易云 weapi 加密的原生实现（AES-128-CBC + RSA NoPadding）。
 *
 * JS 端 crypto-js / node-forge 在 Hermes 上产出错误密文（Node oracle 通过
 * 不代表 Hermes 运行时正确——参考 lx-netease-music-mobile 的做法：weapi
 * 全部走原生 CryptoModule，JS 只负责拼请求）。
 */
public class CryptoModule extends ReactContextBaseJavaModule {
  private static final String MODULE_NAME = "CryptoModule";

  public CryptoModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return MODULE_NAME;
  }

  /**
   * AES 加密（AES/CBC/PKCS5Padding，等价 crypto-js 的 PKCS7）。
   * 输入文本、key、iv 均为 Base64 字符串，返回 Base64 密文。
   */
  @ReactMethod
  public void aesEncrypt(String dataB64, String keyB64, String ivB64, final Promise promise) {
    try {
      Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
      cipher.init(
          Cipher.ENCRYPT_MODE,
          new SecretKeySpec(Base64.decode(keyB64, Base64.NO_WRAP), "AES"),
          new IvParameterSpec(Base64.decode(ivB64, Base64.NO_WRAP)));
      byte[] out = cipher.doFinal(Base64.decode(dataB64, Base64.NO_WRAP));
      promise.resolve(Base64.encodeToString(out, Base64.NO_WRAP));
    } catch (Exception error) {
      promise.reject("CRYPTO_AES_ENCRYPT_FAILED", "AES 加密失败", error);
    }
  }

  /**
   * RSA NoPadding 加密（网易 weapi encSecKey 用）：左侧零填充到 128 字节，
   * 输入为 UTF-8 文本，返回十六进制小写。
   */
  @ReactMethod
  public void rsaNoPaddingEncrypt(String text, String publicKeyPem, final Promise promise) {
    try {
      promise.resolve(rsaNoPaddingEncryptToHex(text.getBytes(StandardCharsets.UTF_8), publicKeyPem));
    } catch (Exception error) {
      promise.reject("CRYPTO_RSA_ENCRYPT_FAILED", "RSA 加密失败", error);
    }
  }

  private static String rsaNoPaddingEncryptToHex(byte[] input, String publicKeyPem) throws Exception {
    String pem = publicKeyPem
        .replace("-----BEGIN PUBLIC KEY-----", "")
        .replace("-----END PUBLIC KEY-----", "")
        .replaceAll("\\s", "");
    PublicKey publicKey = KeyFactory.getInstance("RSA")
        .generatePublic(new X509EncodedKeySpec(Base64.decode(pem, Base64.NO_WRAP)));

    // 左侧零填充到 128 字节（与 NeteaseCloudMusicApi 一致）：
    // 反转后的 secretKey 只有 16 字节，前补 0，NoPadding 下小数值仍落在密钥空间内
    byte[] padded = new byte[128];
    System.arraycopy(input, 0, padded, 128 - input.length, input.length);

    Cipher cipher = Cipher.getInstance("RSA/ECB/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, publicKey);
    byte[] encrypted = cipher.doFinal(padded);

    StringBuilder hex = new StringBuilder(encrypted.length * 2);
    for (byte b : encrypted) {
      hex.append(Character.forDigit((b >> 4) & 0xF, 16));
      hex.append(Character.forDigit(b & 0xF, 16));
    }
    return hex.toString();
  }
}
