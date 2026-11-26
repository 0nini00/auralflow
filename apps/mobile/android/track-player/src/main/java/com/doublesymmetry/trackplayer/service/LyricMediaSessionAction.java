package com.doublesymmetry.trackplayer.service;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;

import com.doublesymmetry.kotlinaudio.notification.NotificationManager;
import com.google.android.exoplayer2.Player;
import com.google.android.exoplayer2.ext.mediasession.MediaSessionConnector;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;

/** 在 RNTP 已有媒体会话和普通通知中发布同一个悬浮歌词操作。 */
public final class LyricMediaSessionAction implements MediaSessionConnector.CustomActionProvider {
    private static final String PREFERENCES_NAME = "auralflow_lyric_overlay";
    private static final String VISIBLE_KEY = "visible";
    private static final String ENABLED_KEY = "notification_button_enabled";
    private static final String TOGGLE_ACTION = "cn.chenle.auralflow.mobile.lyrics.NOTIFICATION_TOGGLE";
    private static final String RECEIVER_CLASS = "cn.chenle.auralflow.mobile.LyricNotificationReceiver";
    private static final int TOGGLE_REQUEST_CODE = 43015;

    private final Context context;
    private final SharedPreferences preferences;
    private final MediaSessionConnector connector;
    private final Field providersField;
    private final int offIcon;
    private final int onIcon;

    public LyricMediaSessionAction(Context context, NotificationManager notificationManager) {
        this.context = context.getApplicationContext();
        preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
        offIcon = requireIcon("ic_notification_lyrics");
        onIcon = requireIcon("ic_notification_lyrics_on");
        try {
            // KotlinAudio v2.1.0 未公开扩展入口；只访问固定版本的连接器和动作列表，
            // 不另建 MediaSession 或替换原有回调。升级依赖须通过原生契约测试。
            Field connectorField = NotificationManager.class.getDeclaredField("mediaSessionConnector");
            connectorField.setAccessible(true);
            connector = (MediaSessionConnector) connectorField.get(notificationManager);
            providersField = MediaSessionConnector.class.getDeclaredField("customActionProviders");
            providersField.setAccessible(true);
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("KotlinAudio 媒体会话接口不兼容，无法注册悬浮歌词开关", error);
        }
    }

    /** 通知配置重建可能替换动作列表，因此每次配置完成后重新接入并保留其它动作。 */
    public void update() {
        try {
            MediaSessionConnector.CustomActionProvider[] existing =
                (MediaSessionConnector.CustomActionProvider[]) providersField.get(connector);
            List<MediaSessionConnector.CustomActionProvider> providers = new ArrayList<>();
            providers.add(this);
            for (MediaSessionConnector.CustomActionProvider provider : existing) {
                if (provider != this) providers.add(provider);
            }
            connector.setCustomActionProviders(providers.toArray(new MediaSessionConnector.CustomActionProvider[0]));
        } catch (IllegalAccessException error) {
            throw new IllegalStateException("无法更新媒体会话悬浮歌词开关", error);
        }
    }

    @Override
    public PlaybackStateCompat.CustomAction getCustomAction(Player player) {
        if (!isEnabled()) return null;
        return new PlaybackStateCompat.CustomAction.Builder(TOGGLE_ACTION, title(), icon()).build();
    }

    @Override
    public void onCustomAction(Player player, String action, Bundle extras) {
        if (!TOGGLE_ACTION.equals(action) || !isEnabled()) return;
        context.sendBroadcast(toggleIntent());
    }

    /** Android 12 及使用通知动作的系统界面与媒体会话使用同一状态和回调。 */
    public Notification buildNotification(Notification base) {
        if (!isEnabled()) return base;
        PendingIntent toggle = PendingIntent.getBroadcast(context, TOGGLE_REQUEST_CODE, toggleIntent(),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Action action = new NotificationCompat.Action.Builder(icon(), title(), toggle).build();
        return new NotificationCompat.Builder(context, base).addAction(action).build();
    }

    private boolean isEnabled() {
        return preferences.getBoolean(ENABLED_KEY, true);
    }

    private String title() {
        return preferences.getBoolean(VISIBLE_KEY, false) ? "关闭悬浮歌词" : "开启悬浮歌词";
    }

    private int icon() {
        return preferences.getBoolean(VISIBLE_KEY, false) ? onIcon : offIcon;
    }

    private Intent toggleIntent() {
        return new Intent(TOGGLE_ACTION).setClassName(context.getPackageName(), RECEIVER_CLASS);
    }

    private int requireIcon(String name) {
        int resource = context.getResources().getIdentifier(name, "drawable", context.getPackageName());
        if (resource == 0) throw new IllegalStateException("缺少悬浮歌词按钮图标：" + name);
        return resource;
    }
}
