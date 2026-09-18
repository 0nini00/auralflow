package cn.chenle.auralflow.mobile;

import android.content.Context;
import android.os.PowerManager;
import android.util.Log;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/**
 * 原生 WakeLock 模块：
 * 在切歌、后台推进和网络解析过渡期持有 PARTIAL_WAKE_LOCK，
 * 避免屏幕关闭/进入口袋时 Android Doze 机制挂起 JS 线程和网络连接，
 * 保证后台切歌平滑流畅（对齐桌面级播放器与 LX-Music 的后台保活策略）。
 */
public class WakeLockModule extends ReactContextBaseJavaModule {
    private static final String TAG = "WakeLockModule";
    private static final String WAKE_LOCK_TAG = "auralflow:playback_transition";
    private final PowerManager.WakeLock wakeLock;

    public WakeLockModule(ReactApplicationContext reactContext) {
        super(reactContext);
        PowerManager pm = (PowerManager) reactContext.getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG);
            wakeLock.setReferenceCounted(false);
        } else {
            wakeLock = null;
        }
    }

    @Override
    public String getName() {
        return "WakeLockModule";
    }

    @ReactMethod
    public void acquire(double timeoutMs, Promise promise) {
        try {
            if (wakeLock != null) {
                long timeout = (long) Math.max(1000, timeoutMs);
                wakeLock.acquire(timeout);
            }
            promise.resolve(true);
        } catch (RuntimeException error) {
            Log.w(TAG, "Failed to acquire wake lock", error);
            promise.resolve(false);
        }
    }

    @ReactMethod
    public void release(Promise promise) {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
            promise.resolve(true);
        } catch (RuntimeException error) {
            Log.w(TAG, "Failed to release wake lock", error);
            promise.resolve(false);
        }
    }
}
