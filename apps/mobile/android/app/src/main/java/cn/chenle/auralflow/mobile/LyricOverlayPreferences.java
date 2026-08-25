package cn.chenle.auralflow.mobile;

import android.content.Context;
import android.content.SharedPreferences;

public final class LyricOverlayPreferences {
    public static final String PREFERENCES_NAME = "auralflow_lyric_overlay";
    public static final String KEY_VISIBLE = "visible";
    public static final String KEY_NOTIFICATION_BUTTON_ENABLED = "notification_button_enabled";

    /** 正在播放行的字号（sp）。 */
    public static final String KEY_FONT_SIZE = "font_size";
    /** 文字整体不透明度，0-100。 */
    public static final String KEY_TEXT_OPACITY = "text_opacity";
    /** 是否显示下一行歌词。 */
    public static final String KEY_SHOW_NEXT_LINE = "show_next_line";
    /** 是否给文字加投影。关掉后在浅色壁纸上会难以辨认，默认开启。 */
    public static final String KEY_SHADOW_ENABLED = "shadow_enabled";

    public static final int DEFAULT_FONT_SIZE = 18;
    public static final int DEFAULT_TEXT_OPACITY = 100;
    public static final String ACTION_NOTIFICATION_STATE_CHANGED =
        "cn.chenle.auralflow.mobile.lyrics.NOTIFICATION_STATE_CHANGED";

    private LyricOverlayPreferences() {}

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    public static boolean isVisible(Context context) {
        return preferences(context).getBoolean(KEY_VISIBLE, false);
    }

    public static void setVisible(Context context, boolean visible) {
        preferences(context).edit().putBoolean(KEY_VISIBLE, visible).apply();
    }

    public static boolean isNotificationButtonEnabled(Context context) {
        return preferences(context).getBoolean(KEY_NOTIFICATION_BUTTON_ENABLED, true);
    }

    public static void setNotificationButtonEnabled(Context context, boolean enabled) {
        preferences(context).edit().putBoolean(KEY_NOTIFICATION_BUTTON_ENABLED, enabled).apply();
    }

    public static int getFontSize(Context context) {
        return preferences(context).getInt(KEY_FONT_SIZE, DEFAULT_FONT_SIZE);
    }

    public static int getTextOpacity(Context context) {
        return preferences(context).getInt(KEY_TEXT_OPACITY, DEFAULT_TEXT_OPACITY);
    }

    public static boolean isShowNextLine(Context context) {
        return preferences(context).getBoolean(KEY_SHOW_NEXT_LINE, true);
    }

    public static boolean isShadowEnabled(Context context) {
        return preferences(context).getBoolean(KEY_SHADOW_ENABLED, true);
    }

    /** 批量写入样式，未传的项保持原值。字号与不透明度会被夹取到合法区间。 */
    public static void setStyle(
        Context context,
        Integer fontSize,
        Integer textOpacity,
        Boolean showNextLine,
        Boolean shadowEnabled
    ) {
        android.content.SharedPreferences.Editor editor = preferences(context).edit();
        if (fontSize != null) {
            editor.putInt(KEY_FONT_SIZE, Math.max(10, Math.min(40, fontSize)));
        }
        if (textOpacity != null) {
            editor.putInt(KEY_TEXT_OPACITY, Math.max(10, Math.min(100, textOpacity)));
        }
        if (showNextLine != null) {
            editor.putBoolean(KEY_SHOW_NEXT_LINE, showNextLine);
        }
        if (shadowEnabled != null) {
            editor.putBoolean(KEY_SHADOW_ENABLED, shadowEnabled);
        }
        editor.apply();
    }

    public static void notifyNotificationStateChanged(Context context) {
        IntentFactory.sendPackageBroadcast(context, ACTION_NOTIFICATION_STATE_CHANGED);
    }

    private static final class IntentFactory {
        private static void sendPackageBroadcast(Context context, String action) {
            android.content.Intent intent = new android.content.Intent(action);
            intent.setPackage(context.getPackageName());
            context.sendBroadcast(intent);
        }
    }
}
