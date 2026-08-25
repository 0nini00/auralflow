package cn.chenle.auralflow.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class SecureStorageModule extends ReactContextBaseJavaModule {
  private static final String MODULE_NAME = "SecureStorageModule";
  private static final String KEYSTORE_NAME = "AndroidKeyStore";
  private static final String KEY_ALIAS = "auralflow.mobile.secure-storage.v2";
  private static final String PREFERENCES_NAME = "auralflow_secure_storage";
  private static final String VALUE_PREFIX = "v1:";
  private static final int GCM_TAG_LENGTH_BITS = 128;
  private static final int IV_LENGTH_BYTES = 12;

  private final ReactApplicationContext context;

  public SecureStorageModule(ReactApplicationContext reactContext) {
    super(reactContext);
    context = reactContext;
  }

  @Override
  public String getName() {
    return MODULE_NAME;
  }

  @ReactMethod
  public void getItem(String key, Promise promise) {
    try {
      validateKey(key);
      SharedPreferences preferences = preferences();
      String encoded = preferences.getString(key, null);
      if (encoded == null) {
        promise.resolve(null);
        return;
      }
      promise.resolve(decrypt(encoded));
    } catch (Exception error) {
      promise.reject("SECURE_STORAGE_READ_FAILED", "读取安全存储失败", error);
    }
  }

  @ReactMethod
  public void setItem(String key, String value, Promise promise) {
    try {
      validateKey(key);
      if (value == null) {
        promise.reject("SECURE_STORAGE_INVALID_VALUE", "安全存储值不能为 null");
        return;
      }
      boolean committed = preferences().edit().putString(key, encrypt(value)).commit();
      if (!committed) {
        throw new IllegalStateException("安全存储写入未提交");
      }
      promise.resolve(null);
    } catch (Exception error) {
      promise.reject("SECURE_STORAGE_WRITE_FAILED", "写入安全存储失败", error);
    }
  }

  @ReactMethod
  public void removeItem(String key, Promise promise) {
    try {
      validateKey(key);
      boolean committed = preferences().edit().remove(key).commit();
      if (!committed) {
        throw new IllegalStateException("安全存储删除未提交");
      }
      promise.resolve(null);
    } catch (Exception error) {
      promise.reject("SECURE_STORAGE_REMOVE_FAILED", "删除安全存储失败", error);
    }
  }

  private SharedPreferences preferences() {
    return context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
  }

  private static void validateKey(String key) {
    if (key == null || key.trim().isEmpty()) {
      throw new IllegalArgumentException("安全存储 key 不能为空");
    }
  }

  private static SecretKey getOrCreateKey() throws Exception {
    KeyStore keyStore = KeyStore.getInstance(KEYSTORE_NAME);
    keyStore.load(null);
    if (!keyStore.containsAlias(KEY_ALIAS)) {
      generateKey();
    }
    try {
      return loadKey(keyStore);
    } catch (Exception error) {
      // Keystore 条目可能因系统升级/备份迁移损坏，此时任何加解密都会失败。
      // 删除旧密钥重新生成；旧数据无法再解密，读取时按空数据处理，
      // 用户重新填一次凭据即可自愈（都是可重填的 Cookie/密码，无永久损失）。
      keyStore.deleteEntry(KEY_ALIAS);
      generateKey();
      return loadKey(keyStore);
    }
  }

  private static void generateKey() throws Exception {
    KeyGenerator generator = KeyGenerator.getInstance(
        KeyProperties.KEY_ALGORITHM_AES,
        KEYSTORE_NAME
    );
    generator.init(new KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
    )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        // 必须允许调用方自带 IV：encrypt() 用 SecureRandom 生成随机 IV 后通过
        // GCMParameterSpec 传入 init()。默认 setRandomizedEncryptionRequired(true)
        // 会拒绝 caller-provided IV，导致每次 setItem 都抛「写入安全存储失败」；
        // getItem（解密侧不受此限制）仍正常，表现为“只有写入失败、读取正常”。
        .setRandomizedEncryptionRequired(false)
        .build());
    generator.generateKey();
  }

  private static SecretKey loadKey(KeyStore keyStore) throws Exception {
    KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null);
    if (entry == null || entry.getSecretKey() == null) {
      throw new IllegalStateException("Android Keystore 密钥不存在");
    }
    return entry.getSecretKey();
  }

  private static String encrypt(String value) throws Exception {
    byte[] iv = new byte[IV_LENGTH_BYTES];
    new SecureRandom().nextBytes(iv);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
    byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
    return VALUE_PREFIX
        + Base64.encodeToString(iv, Base64.NO_WRAP)
        + ":"
        + Base64.encodeToString(ciphertext, Base64.NO_WRAP);
  }

  private static String decrypt(String encoded) throws Exception {
    if (!encoded.startsWith(VALUE_PREFIX)) {
      throw new IllegalArgumentException("不支持的安全存储版本");
    }
    String[] parts = encoded.substring(VALUE_PREFIX.length()).split(":", 2);
    if (parts.length != 2) {
      throw new IllegalArgumentException("安全存储数据格式无效");
    }
    byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
    byte[] ciphertext = Base64.decode(parts[1], Base64.NO_WRAP);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
    return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
  }
}
