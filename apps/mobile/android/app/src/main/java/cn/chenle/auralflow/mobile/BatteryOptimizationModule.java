package cn.chenle.auralflow.mobile;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/**
 * 后台播放保活：检查并申请「忽略电池优化」白名单。
 *
 * 为什么必须做这件事：
 * 本应用的切歌是「真实曲目 + 静音尾轨」双轨模型——曲末由 JS 侧的 TrackPlayer 后台服务
 * 解析下一首的播放地址、入队并跳过。这要求曲末那一刻 JS 线程可被调度。
 * 国产 ROM（OPPO ColorOS / vivo OriginOS / 小米 MIUI 等）在应用未加入电池优化白名单时，
 * 退到后台数十秒就会冻结整个进程（连 JS 线程一起冻住），此时前台服务只保住了「声音」，
 * JS 却无法响应曲末事件：静音尾轨播完即队列见底而停播，回到前台后 JS 解冻、按播放键才恢复。
 * 这与「后台播一两首就停，回前台按一下又能播」的现象完全一致。
 *
 * Android 6.0(M) 起才有该白名单，低版本直接视为已放行。
 */
public class BatteryOptimizationModule extends ReactContextBaseJavaModule {
    private static final String TAG = "BatteryOptimization";

    public BatteryOptimizationModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "BatteryOptimizationModule";
    }

    /** 是否已在「忽略电池优化」白名单中（即系统不会因后台而冻结本应用）。 */
    @ReactMethod
    public void isIgnoringBatteryOptimization(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                promise.resolve(true);
                return;
            }
            Context context = getReactApplicationContext();
            PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (powerManager == null) {
                promise.resolve(true);
                return;
            }
            promise.resolve(powerManager.isIgnoringBatteryOptimizations(context.getPackageName()));
        } catch (RuntimeException error) {
            // 查询失败不应让调用方抛错：宁可当作已放行，也不要弹出无法消除的提示
            Log.w(TAG, "Failed to query battery optimization state", error);
            promise.resolve(true);
        }
    }

    /**
     * 拉起系统「是否允许忽略电池优化」授权页。
     * resolve(true) 表示已成功打开系统页面，并不代表用户已同意——调用方需在回到前台后重新查询。
     */
    @SuppressLint("BatteryLife")
    @ReactMethod
    public void requestIgnoreBatteryOptimization(Promise promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            promise.resolve(false);
            return;
        }
        Context context = getReactApplicationContext();
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        intent.setData(Uri.parse("package:" + context.getPackageName()));
        // 部分 ROM 从后台 Activity 直接 startActivity 会被拦截，补 NEW_TASK 兜底
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            promise.resolve(true);
            return;
        } catch (RuntimeException error) {
            Log.w(TAG, "Failed to open battery optimization settings directly", error);
        }
        // 某些 ROM 移除了该 Action：退回应用详情页，让用户自己找「省电策略」
        try {
            Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            fallback.setData(Uri.parse("package:" + context.getPackageName()));
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(fallback);
            promise.resolve(true);
        } catch (RuntimeException error) {
            Log.w(TAG, "Failed to open app details settings", error);
            promise.resolve(false);
        }
    }
}
