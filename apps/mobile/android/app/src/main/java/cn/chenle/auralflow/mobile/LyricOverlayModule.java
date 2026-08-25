package cn.chenle.auralflow.mobile;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import android.provider.Settings;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.util.concurrent.atomic.AtomicBoolean;

public class LyricOverlayModule extends ReactContextBaseJavaModule {
    private static final int REQUEST_OVERLAY_PERMISSION = 43017;
    private static final String ERROR_NO_ACTIVITY = "E_OVERLAY_NO_ACTIVITY";
    private static final String ERROR_REQUEST_PENDING = "E_OVERLAY_REQUEST_PENDING";
    private static final String ERROR_PERMISSION_LAUNCH = "E_OVERLAY_PERMISSION_LAUNCH";
    private static final String ERROR_DISPATCH_FAILED = "E_OVERLAY_DISPATCH_FAILED";
    private static final String ERROR_OPERATION_TIMEOUT = "E_OVERLAY_OPERATION_TIMEOUT";
    private static final long OVERLAY_OPERATION_TIMEOUT_MS = 5_000L;

    private final ReactApplicationContext context;
    private Promise pendingPermissionPromise;

    private final ActivityEventListener activityEventListener = new BaseActivityEventListener() {
        @Override
        public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
            if (requestCode != REQUEST_OVERLAY_PERMISSION) {
                return;
            }

            Promise promise = pendingPermissionPromise;
            pendingPermissionPromise = null;
            if (promise != null) {
                promise.resolve(Settings.canDrawOverlays(context));
            }
        }
    };

    public LyricOverlayModule(ReactApplicationContext reactContext) {
        super(reactContext);
        context = reactContext;
        reactContext.addActivityEventListener(activityEventListener);
    }

    @Override
    public String getName() {
        return "LyricOverlayModule";
    }

    @ReactMethod
    public void canDrawOverlays(Promise promise) {
        promise.resolve(Settings.canDrawOverlays(context));
    }

    @ReactMethod
    public void isVisible(Promise promise) {
        promise.resolve(LyricOverlayPreferences.isVisible(context));
    }

    /** 读回当前外观，供设置页显示初值。Preferences 是唯一真相，JS 侧不另存一份。 */
    @ReactMethod
    public void getStyle(Promise promise) {
        com.facebook.react.bridge.WritableMap style = com.facebook.react.bridge.Arguments.createMap();
        style.putInt("fontSize", LyricOverlayPreferences.getFontSize(context));
        style.putInt("textOpacity", LyricOverlayPreferences.getTextOpacity(context));
        style.putBoolean("showNextLine", LyricOverlayPreferences.isShowNextLine(context));
        style.putBoolean("shadowEnabled", LyricOverlayPreferences.isShadowEnabled(context));
        promise.resolve(style);
    }

    @ReactMethod
    public void setNotificationButtonEnabled(boolean enabled, Promise promise) {
        LyricOverlayPreferences.setNotificationButtonEnabled(context, enabled);
        LyricOverlayPreferences.notifyNotificationStateChanged(context);
        promise.resolve(null);
    }

    @ReactMethod
    public void requestOverlayPermission(Promise promise) {
        if (Settings.canDrawOverlays(context)) {
            promise.resolve(true);
            return;
        }

        Activity activity = getCurrentActivity();
        if (activity == null) {
            promise.reject(ERROR_NO_ACTIVITY, "当前没有可用的 Android Activity");
            return;
        }
        if (pendingPermissionPromise != null) {
            promise.reject(ERROR_REQUEST_PENDING, "已有悬浮窗权限请求正在进行");
            return;
        }

        Intent intent = new Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:" + context.getPackageName())
        );
        pendingPermissionPromise = promise;
        try {
            activity.startActivityForResult(intent, REQUEST_OVERLAY_PERMISSION);
        } catch (RuntimeException error) {
            pendingPermissionPromise = null;
            promise.reject(ERROR_PERMISSION_LAUNCH, "无法打开悬浮窗权限设置", error);
        }
    }

    @ReactMethod
    public void show(Promise promise) {
        Intent intent = new Intent(context, LyricOverlayService.class);
        intent.setAction(LyricOverlayService.ACTION_SHOW);
        dispatchOperation(intent, promise, false);
    }

    @ReactMethod
    public void hide(Promise promise) {
        Intent intent = new Intent(context, LyricOverlayService.class);
        intent.setAction(LyricOverlayService.ACTION_HIDE);
        dispatchOperation(intent, promise, false);
    }

    @ReactMethod
    public void update(ReadableMap data, Promise promise) {
        Intent intent = new Intent(context, LyricOverlayService.class);
        intent.setAction(LyricOverlayService.ACTION_UPDATE);
        intent.putExtra(
            LyricOverlayService.EXTRA_CURRENT,
            data.hasKey("current") && !data.isNull("current") ? data.getString("current") : ""
        );
        intent.putExtra(
            LyricOverlayService.EXTRA_NEXT,
            data.hasKey("next") && !data.isNull("next") ? data.getString("next") : ""
        );

        dispatchOperation(intent, promise, false);
    }

    /**
     * 写入悬浮歌词外观并就地重刷窗口。
     * 未传的字段保持原值，便于设置页逐项调整而不必每次带全量。
     */
    @ReactMethod
    public void setStyle(ReadableMap style, Promise promise) {
        LyricOverlayPreferences.setStyle(
            context,
            style.hasKey("fontSize") && !style.isNull("fontSize") ? style.getInt("fontSize") : null,
            style.hasKey("textOpacity") && !style.isNull("textOpacity") ? style.getInt("textOpacity") : null,
            style.hasKey("showNextLine") && !style.isNull("showNextLine") ? style.getBoolean("showNextLine") : null,
            style.hasKey("shadowEnabled") && !style.isNull("shadowEnabled") ? style.getBoolean("shadowEnabled") : null
        );

        Intent intent = new Intent(context, LyricOverlayService.class);
        intent.setAction(LyricOverlayService.ACTION_APPLY_STYLE);
        dispatchOperation(intent, promise, false);
    }

    @ReactMethod
    public void setLocked(boolean locked, Promise promise) {
        Intent intent = new Intent(context, LyricOverlayService.class);
        intent.setAction(LyricOverlayService.ACTION_SET_LOCKED);
        intent.putExtra(LyricOverlayService.EXTRA_LOCKED, locked);

        dispatchOperation(intent, promise, true);
    }

    private void dispatchOperation(Intent intent, Promise promise, boolean resolveVoid) {
        Handler handler = new Handler(Looper.getMainLooper());
        AtomicBoolean settled = new AtomicBoolean(false);
        Runnable timeout = () -> {
            if (settled.compareAndSet(false, true)) {
                promise.reject(ERROR_OPERATION_TIMEOUT, "原生悬浮歌词操作等待结果超时");
            }
        };
        ResultReceiver receiver = new ResultReceiver(handler) {
            @Override
            protected void onReceiveResult(int resultCode, Bundle resultData) {
                if (!settled.compareAndSet(false, true)) {
                    return;
                }
                handler.removeCallbacks(timeout);
                if (resultCode == LyricOverlayService.RESULT_SUCCESS) {
                    promise.resolve(resolveVoid ? null : true);
                    return;
                }

                String errorCode = resultData == null
                    ? ERROR_DISPATCH_FAILED
                    : resultData.getString(
                        LyricOverlayService.RESULT_ERROR_CODE,
                        ERROR_DISPATCH_FAILED
                    );
                String errorMessage = resultData == null
                    ? "原生悬浮歌词操作失败"
                    : resultData.getString(
                        LyricOverlayService.RESULT_ERROR_MESSAGE,
                        "原生悬浮歌词操作失败"
                    );
                promise.reject(errorCode, errorMessage);
            }
        };

        intent.putExtra(LyricOverlayService.EXTRA_RESULT_RECEIVER, receiver);
        handler.postDelayed(timeout, OVERLAY_OPERATION_TIMEOUT_MS);
        try {
            ComponentName component = context.startService(intent);
            if (component == null && settled.compareAndSet(false, true)) {
                handler.removeCallbacks(timeout);
                promise.reject(ERROR_DISPATCH_FAILED, "原生悬浮歌词服务未能接收操作");
            }
        } catch (RuntimeException error) {
            if (settled.compareAndSet(false, true)) {
                handler.removeCallbacks(timeout);
                promise.reject(ERROR_DISPATCH_FAILED, "原生悬浮歌词操作分发失败", error);
            }
        }
    }
}
