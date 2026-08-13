package cn.chenle.auralflow.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;

public class LyricNotificationReceiver extends BroadcastReceiver {
    public static final String ACTION_TOGGLE = "cn.chenle.auralflow.mobile.lyrics.NOTIFICATION_TOGGLE";
    private static final String TAG = "LyricNotification";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_TOGGLE.equals(intent.getAction())) {
            return;
        }

        boolean visible = LyricOverlayPreferences.isVisible(context);
        if (!Settings.canDrawOverlays(context)) {
            LyricOverlayPreferences.setVisible(context, false);
            LyricOverlayPreferences.notifyNotificationStateChanged(context);
            Log.w(TAG, "Overlay permission missing; lyric overlay remains off");
            Toast.makeText(context, "请先授予悬浮窗权限", Toast.LENGTH_SHORT).show();
            return;
        }

        Intent serviceIntent = new Intent(context, LyricOverlayService.class);
        serviceIntent.setAction(visible ? LyricOverlayService.ACTION_HIDE : LyricOverlayService.ACTION_SHOW);
        serviceIntent.putExtra(LyricOverlayService.EXTRA_FROM_NOTIFICATION, true);
        try {
            context.startService(serviceIntent);
        } catch (RuntimeException error) {
            LyricOverlayPreferences.setVisible(context, false);
            LyricOverlayPreferences.notifyNotificationStateChanged(context);
            Log.e(TAG, "Unable to toggle lyric overlay from notification", error);
            Toast.makeText(context, "悬浮歌词操作失败", Toast.LENGTH_SHORT).show();
        }
    }
}
