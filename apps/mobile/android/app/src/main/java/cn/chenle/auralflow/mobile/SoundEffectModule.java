package cn.chenle.auralflow.mobile;

import android.content.Context;
import android.media.AudioManager;
import android.media.audiofx.Equalizer;
import android.media.audiofx.PresetReverb;
import android.os.Build;

import java.lang.reflect.Method;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

/**
 * 通过 Android AudioEffect 实现全局音效链：Equalizer + PresetReverb。
 *
 * 使用 audioSession=0 挂全局，作用于系统所有播放（包含 ExoPlayer/TrackPlayer）。
 * 桌面端 5 段 EQ（60/230/910/3600/14000 Hz）在 Android 上映射到硬件支持的
 * 中心频段，若段数不同则由 JS 层做线性插值传入 5 个 gain。
 */
public class SoundEffectModule extends ReactContextBaseJavaModule {

  private Equalizer equalizer;
  private PresetReverb reverb;
  private boolean enabled;

  public SoundEffectModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "SoundEffectModule";
  }

  @Override
  public void invalidate() {
    releaseEffects();
  }

  @ReactMethod
  public void attach(Promise promise) {
    try {
      ensureEffects();
      promise.resolve(true);
    } catch (Exception error) {
      promise.reject("SOUND_EFFECT_ATTACH_FAILED", error);
    }
  }

  @ReactMethod
  public void detach(Promise promise) {
    releaseEffects();
    enabled = false;
    promise.resolve(null);
  }

  private synchronized void ensureEffects() {
    if (equalizer == null) {
      // priority=0，audioSession=0 表示全局效果链
      equalizer = new Equalizer(0, 0);
    }
    if (reverb == null) {
      reverb = new PresetReverb(0, 0);
    }
  }

  private synchronized void releaseEffects() {
    if (equalizer != null) {
      try {
        equalizer.release();
      } catch (Exception ignored) {
      }
      equalizer = null;
    }
    if (reverb != null) {
      try {
        reverb.release();
      } catch (Exception ignored) {
      }
      reverb = null;
    }
  }

  @ReactMethod
  public void getCapabilities(Promise promise) {
    try {
      ensureEffects();
      WritableArray bandFreqs = Arguments.createArray();
      short bandCount = equalizer.getNumberOfBands();
      for (short i = 0; i < bandCount; i++) {
        int[] range = equalizer.getBandFreqRange(i);
        // range[0]/range[1] 单位为 milliHz，中心频率取中点
        int center = (range[0] + range[1]) / 2;
        bandFreqs.pushInt(center);
      }
      WritableMap result = Arguments.createMap();
      // 对齐 JS 侧 SoundEffectCapabilities 契约：
      // supportsEqualizer/supportsReverb 依赖全局 AudioFx，一般可用；
      // 声像/变调在全局 session 0 下无原生实现，标记为不支持。
      result.putBoolean("supportsEqualizer", true);
      result.putBoolean("supportsReverb", true);
      result.putBoolean("supportsPan", false);
      result.putBoolean("supportsPitch", false);
      result.putInt("eqBandCount", bandCount);
      result.putArray("eqFrequencies", bandFreqs);
      promise.resolve(result);
    } catch (Exception error) {
      promise.reject("SOUND_EFFECT_CAPABILITIES_FAILED", error);
    }
  }

  @ReactMethod
  public void setEnabled(boolean value, Promise promise) {
    try {
      ensureEffects();
      enabled = value;
      equalizer.setEnabled(value);
      reverb.setEnabled(value);
      promise.resolve(value);
    } catch (Exception error) {
      promise.reject("SOUND_EFFECT_ENABLE_FAILED", error);
    }
  }

  @ReactMethod
  public void setEqGains(ReadableArray gainsDb, Promise promise) {
    try {
      ensureEffects();
      short bandCount = equalizer.getNumberOfBands();
      short[] range = equalizer.getBandLevelRange();
      for (short i = 0; i < bandCount && i < gainsDb.size(); i++) {
        double gainDb = gainsDb.getDouble(i);
        int millibel = (int) Math.round(gainDb * 100);
        // 夹取到硬件支持范围，防止 IllegalArgumentException
        millibel = Math.max(range[0], Math.min(range[1], millibel));
        equalizer.setBandLevel(i, (short) millibel);
      }
      promise.resolve(bandCount);
    } catch (Exception error) {
      promise.reject("SOUND_EFFECT_EQ_FAILED", error);
    }
  }

  @ReactMethod
  public void setReverbMix(double mix, Promise promise) {
    try {
      ensureEffects();
      double clamped = Math.max(0, Math.min(1, mix));
      // PresetReverb 只有整档预设，用 mix 阈值映射：
      // 0=NONE, 0.2=SMALLROOM, 0.4=MEDIUMROOM, 0.6=LARGEROOM,
      // 0.8=MEDIUMHALL, 1.0=LARGEHALL
      short preset;
      if (clamped < 0.05) preset = PresetReverb.PRESET_NONE;
      else if (clamped < 0.25) preset = PresetReverb.PRESET_SMALLROOM;
      else if (clamped < 0.45) preset = PresetReverb.PRESET_MEDIUMROOM;
      else if (clamped < 0.65) preset = PresetReverb.PRESET_LARGEROOM;
      else if (clamped < 0.85) preset = PresetReverb.PRESET_MEDIUMHALL;
      else preset = PresetReverb.PRESET_LARGEHALL;
      reverb.setPreset(preset);
      promise.resolve((int) preset);
    } catch (Exception error) {
      promise.reject("SOUND_EFFECT_REVERB_FAILED", error);
    }
  }

  @ReactMethod
  public void setPan(double pan, Promise promise) {
    // 桌面端用 WebAudio StereoPanner 实现声像；移动端 Android 无全局 session 声像 AudioFx，
    // 改用 AudioManager.setBalance（API 29+）做整机左右声道平衡，覆盖本应用播放场景。
    try {
      AudioManager audioManager = (AudioManager) getReactApplicationContext()
          .getSystemService(Context.AUDIO_SERVICE);
      if (audioManager != null) {
        float balance = (float) Math.max(-1.0, Math.min(1.0, pan));
        Method setBalance = AudioManager.class.getMethod("setBalance", float.class);
        setBalance.invoke(audioManager, balance);
      }
      promise.resolve(null);
    } catch (NoSuchMethodException ignored) {
      promise.resolve(null);
    } catch (Exception error) {
      promise.reject("SOUND_EFFECT_PAN_FAILED", error);
    }
  }

  @ReactMethod
  public void setPitch(double semitones, Promise promise) {
    // Android AudioFx 无独立 Pitch Shift，返回 false 表示不支持（与 JS 注释一致）。
    promise.resolve(false);
  }

  @ReactMethod
  public void release(Promise promise) {
    releaseEffects();
    enabled = false;
    promise.resolve(true);
  }

  @ReactMethod
  public void isEnabled(Promise promise) {
    promise.resolve(enabled);
  }
}
