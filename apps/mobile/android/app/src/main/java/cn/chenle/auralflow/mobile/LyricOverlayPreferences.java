package cn.chenle.auralflow.mobile;

import android.content.Context;
import android.content.SharedPreferences;

public final class LyricOverlayPreferences {
    public static final String PREFERENCES_NAME = "auralflow_lyric_overlay";
    public static final String KEY_VISIBLE = "visible";
    public static final String KEY_NOTIFICATION_BUTTON_ENABLED = "notification_button_enabled";
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
