const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const mobileRoot = path.resolve(__dirname, '..');
const source = path.join(mobileRoot, 'android/track-player/src/main/java/com/doublesymmetry/trackplayer/service/LyricMediaSessionAction.java');

function run(tool, args, cwd) {
  const command = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', tool) : tool;
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 25000, windowsHide: true });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test('系统媒体会话提供独立歌词开关，保留媒体控制并从原生状态刷新图标', { timeout: 60000 }, () => {
  assert.ok(fs.existsSync(source), '缺少系统媒体会话歌词动作');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'auralflow-lyric-session-'));
  try {
    const fixtures = {
      'android/os/Bundle.java': 'package android.os; public class Bundle {}',
      'android/os/Build.java': 'package android.os; public class Build { public static class VERSION { public static int SDK_INT=33; } }',
      'android/content/SharedPreferences.java': `package android.content; public interface SharedPreferences { boolean getBoolean(String key, boolean fallback); }`,
      'android/content/res/Resources.java': `package android.content.res;
        public class Resources { public int getIdentifier(String name,String type,String pkg) { return name.equals("ic_notification_lyrics_on")?12:name.equals("ic_notification_lyrics")?11:0; } }`,
      'android/content/Intent.java': `package android.content;
        public class Intent { public String action, pkg, className;
          public Intent(String action) { this.action=action; }
          public Intent setClassName(String pkg,String className) { this.pkg=pkg; this.className=className; return this; }
        }`,
      'android/content/Context.java': `package android.content;
        public class Context {
          public static final int MODE_PRIVATE=0;
          public boolean enabled=true, visible=false;
          public Intent sent;
          public Context getApplicationContext() { return this; }
          public String getPackageName() { return "cn.chenle.auralflow.mobile"; }
          public SharedPreferences getSharedPreferences(String name,int mode) {
            if (!name.equals("auralflow_lyric_overlay")) throw new AssertionError(name);
            return (key,fallback) -> key.equals("visible")?visible:key.equals("notification_button_enabled")?enabled:fallback;
          }
          public android.content.res.Resources getResources() { return new android.content.res.Resources(); }
          public void sendBroadcast(Intent intent) { sent=intent; }
        }`,
      'android/app/PendingIntent.java': `package android.app;
        import android.content.*;
        public class PendingIntent {
          public static final int FLAG_IMMUTABLE=1, FLAG_UPDATE_CURRENT=2;
          public final Intent intent;
          private PendingIntent(Intent intent) { this.intent=intent; }
          public static PendingIntent getBroadcast(Context c,int id,Intent intent,int flags) {
            if ((flags&FLAG_IMMUTABLE)==0) throw new AssertionError("mutable pending intent");
            return new PendingIntent(intent);
          }
        }`,
      'android/app/Notification.java': `package android.app;
        import java.util.*;
        import androidx.core.app.NotificationCompat;
        public class Notification {
          public final List<NotificationCompat.Action> actions=new ArrayList<>();
          public String title="song";
        }`,
      'androidx/core/app/NotificationCompat.java': `package androidx.core.app;
        import android.app.*; import android.content.*;
        public class NotificationCompat {
          public static class Action {
            public final int icon; public final String title; public final PendingIntent intent;
            public Action(int icon,String title,PendingIntent intent) { this.icon=icon;this.title=title;this.intent=intent; }
            public static class Builder {
              private final Action action;
              public Builder(int icon,CharSequence title,PendingIntent intent) { action=new Action(icon,title.toString(),intent); }
              public Action build() { return action; }
            }
          }
          public static class Builder {
            final Notification result=new Notification();
            public Builder(Context context,Notification base) { result.title=base.title;result.actions.addAll(base.actions); }
            public Builder addAction(Action action) { result.actions.add(action);return this; }
            public Notification build() { return result; }
          }
        }`,
      'android/support/v4/media/session/PlaybackStateCompat.java': `package android.support.v4.media.session;
        public class PlaybackStateCompat {
          public static class CustomAction {
            public String action,name; public int icon;
            public String getAction() { return action; }
            public CharSequence getName() { return name; }
            public int getIcon() { return icon; }
            public static class Builder {
              private final CustomAction result=new CustomAction();
              public Builder(String action,CharSequence name,int icon) { result.action=action;result.name=name.toString();result.icon=icon; }
              public CustomAction build() { return result; }
            }
          }
        }`,
      'com/google/android/exoplayer2/Player.java': 'package com.google.android.exoplayer2; public interface Player {}',
      'com/google/android/exoplayer2/ext/mediasession/MediaSessionConnector.java': `package com.google.android.exoplayer2.ext.mediasession;
        import com.google.android.exoplayer2.Player;
        import android.os.Bundle;
        import android.support.v4.media.session.PlaybackStateCompat;
        import java.util.*;
        public class MediaSessionConnector {
          public interface CustomActionProvider {
            PlaybackStateCompat.CustomAction getCustomAction(Player player);
            void onCustomAction(Player player,String action,Bundle extras);
          }
          private CustomActionProvider[] customActionProviders=new CustomActionProvider[0];
          public List<PlaybackStateCompat.CustomAction> published=new ArrayList<>();
          public void setCustomActionProviders(CustomActionProvider... providers) {
            customActionProviders=providers; invalidateMediaSessionPlaybackState();
          }
          public void invalidateMediaSessionPlaybackState() {
            published.clear();
            for(CustomActionProvider provider:customActionProviders) {
              PlaybackStateCompat.CustomAction action=provider.getCustomAction(null);
              if(action!=null) published.add(action);
            }
          }
          public void click(String action) {
            for(CustomActionProvider provider:customActionProviders) {
              PlaybackStateCompat.CustomAction custom=provider.getCustomAction(null);
              if(custom!=null && custom.action.equals(action)) provider.onCustomAction(null,action,null);
            }
          }
        }`,
      'com/doublesymmetry/kotlinaudio/notification/NotificationManager.java': `package com.doublesymmetry.kotlinaudio.notification;
        import com.google.android.exoplayer2.ext.mediasession.MediaSessionConnector;
        public class NotificationManager {
          private final MediaSessionConnector mediaSessionConnector;
          public NotificationManager(MediaSessionConnector connector) { this.mediaSessionConnector=connector; }
        }`,
      'MediaActionHarness.java': `import android.content.*; import android.app.*;
        import android.support.v4.media.session.PlaybackStateCompat;
        import com.google.android.exoplayer2.Player;
        import com.google.android.exoplayer2.ext.mediasession.MediaSessionConnector;
        import com.doublesymmetry.kotlinaudio.notification.NotificationManager;
        import com.doublesymmetry.trackplayer.service.LyricMediaSessionAction;
        public class MediaActionHarness {
          static void check(boolean condition,String message) { if(!condition) throw new AssertionError(message); }
          public static void main(String[] args) {
            Context context=new Context();
            MediaSessionConnector connector=new MediaSessionConnector();
            int[] oldCalls={0};
            MediaSessionConnector.CustomActionProvider old=new MediaSessionConnector.CustomActionProvider() {
              public PlaybackStateCompat.CustomAction getCustomAction(Player player) { return new PlaybackStateCompat.CustomAction.Builder("existing","existing",10).build(); }
              public void onCustomAction(Player player,String action,android.os.Bundle extras) { oldCalls[0]++; }
            };
            connector.setCustomActionProviders(old);
            LyricMediaSessionAction lyrics=new LyricMediaSessionAction(context,new NotificationManager(connector));
            lyrics.update();
            check(connector.published.size()==2,"preserve existing actions");
            PlaybackStateCompat.CustomAction off=connector.published.get(0);
            check(off.getName().equals("开启悬浮歌词") && off.getIcon()==11,"off state");
            connector.click(off.getAction());
            check(context.sent!=null && context.sent.action.endsWith("NOTIFICATION_TOGGLE"),"native toggle");
            check(context.sent.className.equals("cn.chenle.auralflow.mobile.LyricNotificationReceiver"),"explicit native receiver");
            connector.click("existing"); check(oldCalls[0]==1,"old callback survives");
            lyrics.update(); check(connector.published.size()==2,"idempotent");
            context.visible=true; lyrics.update();
            check(connector.published.get(0).getName().equals("关闭悬浮歌词") && connector.published.get(0).getIcon()==12,"on state refresh");
            context.enabled=false; lyrics.update();
            check(connector.published.size()==1 && connector.published.get(0).getAction().equals("existing"),"setting removes only lyric action");
            context.sent=null; lyrics.onCustomAction(null,off.getAction(),null); check(context.sent==null,"stale disabled click ignored");
            context.enabled=true;
            connector.setCustomActionProviders(old); lyrics.update();
            check(connector.published.size()==2,"reattach after library option update");
            Notification base=new Notification();
            base.actions.add(new androidx.core.app.NotificationCompat.Action(1,"previous",null));
            base.actions.add(new androidx.core.app.NotificationCompat.Action(2,"play",null));
            base.actions.add(new androidx.core.app.NotificationCompat.Action(3,"next",null));
            Notification built=lyrics.buildNotification(base);
            check(base.actions.size()==3 && built.actions.size()==4,"append without mutating base");
            check(built.actions.get(3).title.equals("关闭悬浮歌词"),"notification and session agree");
            check(lyrics.buildNotification(base).actions.size()==4,"notification refresh deduplicates");
            context.enabled=false; check(lyrics.buildNotification(base)==base,"disabled notification unchanged");
            System.out.println("PASS lyric media session");
          }
        }`,
    };
    const files = [];
    for (const [relative, content] of Object.entries(fixtures)) {
      const file = path.join(work, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      files.push(file);
    }
    run('javac', ['-encoding', 'UTF-8', '-d', work, source, ...files], work);
    assert.match(run('java', ['-cp', work, 'MediaActionHarness'], work), /PASS lyric media session/);
  } finally {
    assert.equal(path.dirname(path.resolve(work)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(work).startsWith('auralflow-lyric-session-'));
    fs.rmSync(work, { recursive: true });
  }
});
