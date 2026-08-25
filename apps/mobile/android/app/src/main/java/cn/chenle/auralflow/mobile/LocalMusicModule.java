package cn.chenle.auralflow.mobile;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import org.jaudiotagger.audio.AudioFile;
import org.jaudiotagger.audio.AudioFileIO;
import org.jaudiotagger.tag.FieldKey;
import org.jaudiotagger.tag.Tag;
import org.jaudiotagger.tag.images.Artwork;
import org.jaudiotagger.tag.images.ArtworkFactory;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;

/**
 * 通过 Android MediaStore 读写设备本地音乐文件的原生模块。
 *
 * 暴露给 JS 的方法：
 * - {@code scanLocalMusic()}：扫描音频库，返回歌曲列表。
 * - {@code updateAudioMetadata(mediaId, metadata)}：把标题/歌手/专辑写回 MediaStore 文本字段。
 * - {@code writeAudioCover(mediaId, imageUri)}：把图片字节写回音频文件内嵌封面（APIC 帧）。
 * - {@code writeAudioLyrics(mediaId, lrc)}：把 LRC 歌词写回音频文件内嵌歌词（USLT 帧）。
 *
 * 写内嵌封面/歌词需要修改文件本身（而非 MediaStore 数据库），因此使用 jaudiotagger 操作 ID3/MP4 标签。
 * Android 10+ 对“非本应用拥有的媒体文件”写入会抛出 RecoverableSecurityException，
 * 此时通过 MediaStore.createWriteRequest 向用户申请授权，授权成功后自动重试写入。
 */
public class LocalMusicModule extends ReactContextBaseJavaModule {

  private static final String ALBUM_ART_BASE_URI = "content://media/external/audio/albumart";
  private static final int REQUEST_WRITE_AUDIO = 43014;
  private static final int REQUEST_PICK_AUDIO = 43015;
  private static final int REQUEST_UPDATE_AUDIO = 43016;

  /** 等待用户授权后重试的写操作。 */
  private static final class PendingWrite {
    final Uri audioUri;
    final TagMutator mutator;
    final Promise promise;

    PendingWrite(Uri audioUri, TagMutator mutator, Promise promise) {
      this.audioUri = audioUri;
      this.mutator = mutator;
      this.promise = promise;
    }
  }

  /** 等待用户授权后重试的 MediaStore 元数据更新。 */
  private static final class PendingMetadataUpdate {
    final Uri audioUri;
    final ContentValues values;
    final Promise promise;

    PendingMetadataUpdate(Uri audioUri, ContentValues values, Promise promise) {
      this.audioUri = audioUri;
      this.values = values;
      this.promise = promise;
    }
  }

  private PendingWrite writePending;
  private PendingMetadataUpdate updatePending;
  private Promise pickAudioPromise;

  private interface TagMutator {
    void mutate(AudioFile audioFile, Tag tag) throws Exception;
  }

  private final ActivityEventListener writeActivityEventListener = new BaseActivityEventListener() {
    @Override
    public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
      if (requestCode == REQUEST_PICK_AUDIO) {
        handlePickAudioResult(resultCode, data);
        return;
      }
      if (requestCode == REQUEST_UPDATE_AUDIO) {
        handleUpdateAccessResult(resultCode);
        return;
      }
      if (requestCode != REQUEST_WRITE_AUDIO) {
        return;
      }
      PendingWrite pending = writePending;
      writePending = null;
      if (pending == null || pending.promise == null) {
        return;
      }
      if (resultCode != Activity.RESULT_OK) {
        pending.promise.reject("WRITE_DENIED", "用户拒绝了修改媒体文件的授权");
        return;
      }
      // 授权成功，重试真正的写入。
      writeTagToFile(pending.audioUri, pending.mutator, pending.promise);
    }
  };

  public LocalMusicModule(ReactApplicationContext reactContext) {
    super(reactContext);
    reactContext.addActivityEventListener(writeActivityListener());
  }

  private ActivityEventListener writeActivityListener() {
    return writeActivityEventListener;
  }

  @Override
  public String getName() {
    return "LocalMusicModule";
  }

  /**
   * 打开系统文档选择器，让用户手动挑选音频文件加入本地曲库。
   * 支持多选；用户取消时 resolve 空数组。
   */
  @ReactMethod
  public void pickLocalAudioFiles(Promise promise) {
    Activity activity = getCurrentActivity();
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "当前没有可用的 Android Activity");
      return;
    }
    if (pickAudioPromise != null) {
      promise.reject("PICKER_BUSY", "已有音频选择请求正在进行");
      return;
    }

    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType("audio/*");
    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
    intent.addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
    );

    pickAudioPromise = promise;
    try {
      activity.startActivityForResult(intent, REQUEST_PICK_AUDIO);
    } catch (Exception error) {
      pickAudioPromise = null;
      promise.reject("PICKER_LAUNCH_FAILED", error);
    }
  }

  private void handlePickAudioResult(int resultCode, Intent data) {
    Promise promise = pickAudioPromise;
    pickAudioPromise = null;
    if (promise == null) {
      return;
    }

    if (resultCode != Activity.RESULT_OK || data == null) {
      promise.resolve(Arguments.createArray());
      return;
    }

    WritableArray songs = Arguments.createArray();
    ContentResolver resolver = getReactApplicationContext().getContentResolver();

    try {
      if (data.getClipData() != null) {
        int count = data.getClipData().getItemCount();
        for (int i = 0; i < count; i += 1) {
          Uri uri = data.getClipData().getItemAt(i).getUri();
          if (uri == null) continue;
          takeReadPermission(resolver, uri, data);
          WritableMap song = buildSongFromUri(resolver, uri);
          if (song != null) {
            songs.pushMap(song);
          }
        }
      } else if (data.getData() != null) {
        Uri uri = data.getData();
        takeReadPermission(resolver, uri, data);
        WritableMap song = buildSongFromUri(resolver, uri);
        if (song != null) {
          songs.pushMap(song);
        }
      }
      promise.resolve(songs);
    } catch (Exception error) {
      promise.reject("LOCAL_MUSIC_PICK_FAILED", error);
    }
  }

  private void takeReadPermission(ContentResolver resolver, Uri uri, Intent data) {
    try {
      int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
      int grantedFlags = data.getFlags() & flags;
      if (grantedFlags == 0) {
        grantedFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
      }
      resolver.takePersistableUriPermission(uri, grantedFlags);
    } catch (Exception ignored) {
      // 部分文档提供方不支持 persistable permission，短期 URI 仍可播放。
    }
  }

  /**
   * 把用户选中的 content URI 解析成与 scanLocalMusic 一致的歌曲 map。
   * 优先走 MediaStore 查询；查不到时用 display name 兜底。
   */
  private WritableMap buildSongFromUri(ContentResolver resolver, Uri uri) {
    if (uri == null) {
      return null;
    }

    String[] projection = new String[] {
      MediaStore.Audio.Media._ID,
      MediaStore.Audio.Media.TITLE,
      MediaStore.Audio.Media.ARTIST,
      MediaStore.Audio.Media.ALBUM,
      MediaStore.Audio.Media.ALBUM_ID,
      MediaStore.Audio.Media.DURATION,
      MediaStore.Audio.Media.DATA,
      MediaStore.Audio.Media.DISPLAY_NAME,
    };

    Cursor cursor = null;
    try {
      cursor = resolver.query(uri, projection, null, null, null);
      if (cursor != null && cursor.moveToFirst()) {
        int idIndex = cursor.getColumnIndex(MediaStore.Audio.Media._ID);
        int titleIndex = cursor.getColumnIndex(MediaStore.Audio.Media.TITLE);
        int artistIndex = cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST);
        int albumIndex = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM);
        int albumIdIndex = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM_ID);
        int durationIndex = cursor.getColumnIndex(MediaStore.Audio.Media.DURATION);
        int dataIndex = cursor.getColumnIndex(MediaStore.Audio.Media.DATA);
        int displayNameIndex = cursor.getColumnIndex(MediaStore.Audio.Media.DISPLAY_NAME);

        String id = idIndex >= 0 && !cursor.isNull(idIndex)
            ? Long.toString(cursor.getLong(idIndex))
            : uri.toString();
        String title = titleIndex >= 0 ? safeString(cursor, titleIndex) : "";
        if (title.isEmpty() && displayNameIndex >= 0) {
          title = stripExtension(safeString(cursor, displayNameIndex));
        }
        if (title.isEmpty()) {
          title = "未知歌曲";
        }
        String artist = artistIndex >= 0 ? safeString(cursor, artistIndex) : "";
        String album = albumIndex >= 0 ? safeString(cursor, albumIndex) : "";
        long albumId = albumIdIndex >= 0 && !cursor.isNull(albumIdIndex)
            ? cursor.getLong(albumIdIndex)
            : 0L;
        long durationMs = durationIndex >= 0 && !cursor.isNull(durationIndex)
            ? cursor.getLong(durationIndex)
            : 0L;
        String filePath = dataIndex >= 0 ? safeString(cursor, dataIndex) : "";
        if (filePath.isEmpty()) {
          filePath = uri.toString();
        }

        WritableMap song = Arguments.createMap();
        song.putString("id", id);
        song.putString("title", title);
        song.putString("artist", artist.isEmpty() ? "未知艺术家" : artist);
        song.putString("album", album.isEmpty() ? "未知专辑" : album);
        song.putDouble("duration", (double) durationMs);
        song.putString("filePath", filePath);
        song.putString("contentUri", uri.toString());

        // 内嵌歌词 → 同名 .lrc 旁挂；封面 albumart → sidecar 图片（仅当有真实文件路径时）。
        File audioFile = filePath.startsWith("/") ? new File(filePath) : null;
        String lyrics = resolveLyrics(audioFile);
        if (lyrics != null) {
          song.putString("lyrics", lyrics);
        }
        String coverUri = resolveCover(resolver, albumId, audioFile);
        if (coverUri != null) {
          song.putString("albumArtUri", coverUri);
        }
        return song;
      }
    } catch (Exception ignored) {
      // fall through to display-name fallback
    } finally {
      if (cursor != null) {
        cursor.close();
      }
    }

    // MediaStore 查不到时，至少保证能进列表并尝试播放 content URI
    String displayName = uri.getLastPathSegment();
    if (displayName == null || displayName.isEmpty()) {
      displayName = "未知歌曲";
    } else {
      displayName = stripExtension(displayName);
    }
    WritableMap fallback = Arguments.createMap();
    fallback.putString("id", uri.toString());
    fallback.putString("title", displayName);
    fallback.putString("artist", "未知艺术家");
    fallback.putString("album", "未知专辑");
    fallback.putDouble("duration", 0);
    fallback.putString("filePath", uri.toString());
    fallback.putString("contentUri", uri.toString());
    return fallback;
  }

  /* ------------------------------------------------------------------ */
  /* 内嵌歌词 / 同名 .lrc 旁挂歌词 / sidecar 封面                        */
  /* ------------------------------------------------------------------ */

  private static final int MAX_LOCAL_LYRICS_BYTES = 512 * 1024;
  private static final String[] SIDECAR_COVER_NAMES = {
    "folder.jpg", "Folder.jpg", "cover.jpg", "Cover.jpg",
    "folder.png", "Folder.png", "cover.png", "Cover.png",
  };

  /**
   * 读取音频文件内嵌歌词（USLT/UNSYNCEDLYRICS 帧）。无内嵌歌词或读取失败返回 null。
   * 对齐桌面端 Rust getAudioInfo 返回的 lyrics 字段。
   */
  private static String readEmbeddedLyrics(File audioFile) {
    if (audioFile == null || !audioFile.exists() || !audioFile.isFile()) {
      return null;
    }
    try {
      AudioFile af = AudioFileIO.read(audioFile);
      if (af == null) {
        return null;
      }
      Tag tag = af.getTag();
      if (tag == null) {
        return null;
      }
      // jaudiotagger 的 FieldKey.LYRICS 统一映射 MP3 USLT / MP4 歌词帧。
      String lyrics = tag.getFirst(FieldKey.LYRICS);
      return (lyrics == null || lyrics.trim().isEmpty()) ? null : lyrics;
    } catch (Exception ignored) {
      return null;
    }
  }

  /** 读取音频同目录的「同名.lrc」旁挂歌词文件（桌面端同款约定）。无或过大返回 null。 */
  private static String readSidecarLrc(File audioFile) {
    if (audioFile == null || !audioFile.exists()) {
      return null;
    }
    String path = audioFile.getAbsolutePath();
    int dot = path.lastIndexOf('.');
    File lrc = new File(dot > 0 ? path.substring(0, dot) + ".lrc" : path + ".lrc");
    if (!lrc.exists() || !lrc.isFile() || lrc.length() > MAX_LOCAL_LYRICS_BYTES) {
      return null;
    }
    try {
      StringBuilder sb = new StringBuilder((int) lrc.length() + 16);
      try (BufferedReader reader = new BufferedReader(
          new InputStreamReader(new FileInputStream(lrc), StandardCharsets.UTF_8))) {
        String line;
        while ((line = reader.readLine()) != null) {
          sb.append(line).append('\n');
        }
      }
      return sb.length() == 0 ? null : sb.toString();
    } catch (Exception ignored) {
      return null;
    }
  }

  /** 歌词解析顺序：内嵌歌词优先，其次同名 .lrc 旁挂文件。 */
  private static String resolveLyrics(File audioFile) {
    String embedded = readEmbeddedLyrics(audioFile);
    if (embedded != null) {
      return embedded;
    }
    return readSidecarLrc(audioFile);
  }

  /** 查找同目录 sidecar 封面（folder.jpg / cover.jpg / 同名图片）。 */
  private static String findSidecarCover(File audioFile) {
    if (audioFile == null || !audioFile.exists()) {
      return null;
    }
    File dir = audioFile.getParentFile();
    if (dir == null || !dir.isDirectory()) {
      return null;
    }
    for (String name : SIDECAR_COVER_NAMES) {
      File cover = new File(dir, name);
      if (cover.exists() && cover.isFile()) {
        return "file://" + cover.getAbsolutePath();
      }
    }
    String base = audioFile.getName();
    int dot = base.lastIndexOf('.');
    String stem = dot > 0 ? base.substring(0, dot) : base;
    for (String ext : new String[] { ".jpg", ".jpeg", ".png" }) {
      File cover = new File(dir, stem + ext);
      if (cover.exists() && cover.isFile()) {
        return "file://" + cover.getAbsolutePath();
      }
    }
    return null;
  }

  /** MediaStore albumart URI 是否真的存在（无内嵌封面时该 URI 指向不存在的文件）。 */
  private static boolean albumArtExists(ContentResolver resolver, Uri albumArtUri) {
    try {
      InputStream in = resolver.openInputStream(albumArtUri);
      if (in == null) {
        return false;
      }
      in.close();
      return true;
    } catch (Exception ignored) {
      return false;
    }
  }

  /** 封面解析顺序：MediaStore albumart 优先，其次同目录 sidecar 图片。 */
  private static String resolveCover(ContentResolver resolver, long albumId, File audioFile) {
    if (albumId > 0) {
      Uri albumArtUri = ContentUris.withAppendedId(Uri.parse(ALBUM_ART_BASE_URI), albumId);
      if (albumArtExists(resolver, albumArtUri)) {
        return albumArtUri.toString();
      }
    }
    return findSidecarCover(audioFile);
  }

  private static String stripExtension(String name) {
    if (name == null || name.isEmpty()) {
      return "未知歌曲";
    }
    int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf(':'));
    if (slash >= 0 && slash < name.length() - 1) {
      name = name.substring(slash + 1);
    }
    int dot = name.lastIndexOf('.');
    if (dot > 0) {
      return name.substring(0, dot);
    }
    return name;
  }

  @ReactMethod
  public void scanLocalMusic(Promise promise) {
    try {
      ContentResolver resolver = getReactApplicationContext().getContentResolver();
      Uri collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;

      String[] projection = new String[] {
        MediaStore.Audio.Media._ID,
        MediaStore.Audio.Media.TITLE,
        MediaStore.Audio.Media.ARTIST,
        MediaStore.Audio.Media.ALBUM,
        MediaStore.Audio.Media.ALBUM_ID,
        MediaStore.Audio.Media.DURATION,
        MediaStore.Audio.Media.DATA,
      };

      String selection = MediaStore.Audio.Media.IS_MUSIC + " != 0";
      String sortOrder = MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC";

      WritableArray songs = Arguments.createArray();

      Cursor cursor = resolver.query(collection, projection, selection, null, sortOrder);
      if (cursor != null) {
        try {
          int idIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
          int titleIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
          int artistIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
          int albumIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
          int albumIdIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID);
          int durationIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
          int dataIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA);

          while (cursor.moveToNext()) {
            long id = cursor.getLong(idIndex);
            String title = safeString(cursor, titleIndex);
            String artist = safeString(cursor, artistIndex);
            String album = safeString(cursor, albumIndex);
            long albumId = cursor.getLong(albumIdIndex);
            long durationMs = cursor.getLong(durationIndex);
            String filePath = safeString(cursor, dataIndex);

            if (title.isEmpty() || filePath.isEmpty()) {
              continue;
            }

            String contentUri = ContentUris.withAppendedId(collection, id).toString();

            WritableMap song = Arguments.createMap();
            song.putString("id", Long.toString(id));
            song.putString("title", title);
            song.putString("artist", artist.isEmpty() ? "未知艺术家" : artist);
            song.putString("album", album.isEmpty() ? "未知专辑" : album);
            song.putDouble("duration", (double) durationMs);
            song.putString("filePath", filePath);
            song.putString("contentUri", contentUri);

            // 内嵌歌词（USLT）→ 同名 .lrc 旁挂文件；封面 albumart → folder.jpg/cover.jpg 兜底。
            String lyrics = resolveLyrics(new File(filePath));
            if (lyrics != null) {
              song.putString("lyrics", lyrics);
            }
            String coverUri = resolveCover(resolver, albumId, new File(filePath));
            if (coverUri != null) {
              song.putString("albumArtUri", coverUri);
            }

            songs.pushMap(song);
          }
        } finally {
          cursor.close();
        }
      }

      promise.resolve(songs);
    } catch (Exception error) {
      promise.reject("LOCAL_MUSIC_SCAN_FAILED", error);
    }
  }

  /**
   * 把标题/歌手/专辑写回 MediaStore 元数据（文本字段）。
   */
  @ReactMethod
  public void updateAudioMetadata(String mediaId, ReadableMap metadata, Promise promise) {
    ContentResolver resolver = getReactApplicationContext().getContentResolver();
    Uri uri = null;
    ContentValues values = null;
    try {
      uri = ContentUris.withAppendedId(
          MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, Long.parseLong(mediaId));

      values = new ContentValues();
      if (metadata.hasKey("title")) {
        values.put(MediaStore.Audio.Media.TITLE, metadata.getString("title"));
      }
      if (metadata.hasKey("artist")) {
        values.put(MediaStore.Audio.Media.ARTIST, metadata.getString("artist"));
      }
      if (metadata.hasKey("album")) {
        values.put(MediaStore.Audio.Media.ALBUM, metadata.getString("album"));
      }

      int rows = resolver.update(uri, values, null, null);
      promise.resolve(rows);
    } catch (SecurityException securityError) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
          && securityError instanceof android.app.RecoverableSecurityException) {
        requestUpdateAccess(uri, values, promise);
      } else {
        promise.reject("LOCAL_MUSIC_UPDATE_FAILED", securityError);
      }
    } catch (Exception error) {
      promise.reject("LOCAL_MUSIC_UPDATE_FAILED", error);
    }
  }

  /**
   * 把图片字节写回音频文件的内嵌封面（APIC 帧）。imageUri 为图片的 content:// URI。
   *
   * 写入流程：先从音频 content URI 拷贝到应用缓存临时文件，用 jaudiotagger 修改标签，
   * 再把临时文件覆盖写回原音频 content URI。Android 10+ 写回可能触发 RecoverableSecurityException，
   * 此时发起授权，用户同意后自动重试。
   */
  @ReactMethod
  public void writeAudioCover(String mediaId, String imageUri, Promise promise) {
    try {
      Uri audioUri = ContentUris.withAppendedId(
          MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, Long.parseLong(mediaId));
      Uri coverUri = Uri.parse(imageUri);
      ContentResolver resolver = getReactApplicationContext().getContentResolver();
      byte[] imageBytes = readAllBytes(resolver, coverUri);
      if (imageBytes == null || imageBytes.length == 0) {
        promise.reject("LOCAL_MUSIC_COVER_EMPTY", "图片内容为空，无法写入封面");
        return;
      }
      String resolvedMime = resolver.getType(coverUri);
      final String mime = resolvedMime != null ? resolvedMime : "image/jpeg";
      TagMutator mutator = (audioFile, tag) -> {
        tag.deleteField(FieldKey.COVER_ART);
        Artwork artwork = ArtworkFactory.getNew();
        artwork.setBinaryData(imageBytes);
        artwork.setMimeType(mime);
        tag.setField(artwork);
      };
      writeTagToFile(audioUri, mutator, promise);
    } catch (Exception error) {
      promise.reject("LOCAL_MUSIC_COVER_FAILED", error);
    }
  }

  /**
   * 把 LRC 歌词写回音频文件内嵌歌词（MP3 为 USLT 帧，其他格式由 jaudiotagger 适配）。
   * lrc 为空字符串时清除内嵌歌词。
   */
  @ReactMethod
  public void writeAudioLyrics(String mediaId, String lrc, Promise promise) {
    try {
      Uri audioUri = ContentUris.withAppendedId(
          MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, Long.parseLong(mediaId));
      final String lyrics = lrc == null ? "" : lrc;
      TagMutator mutator = (audioFile, tag) -> {
        tag.deleteField(FieldKey.LYRICS);
        if (!lyrics.isEmpty()) {
          tag.setField(FieldKey.LYRICS, lyrics);
        }
      };
      writeTagToFile(audioUri, mutator, promise);
    } catch (Exception error) {
      promise.reject("LOCAL_MUSIC_LYRICS_FAILED", error);
    }
  }

  /**
   * 通用写标签流程：拷贝到临时文件 -> jaudiotagger 修改 -> 覆盖写回原音频 URI。
   * 遇到 RecoverableSecurityException 时发起写授权，授权成功后由 ActivityEventListener 重试。
   */
  private void writeTagToFile(Uri audioUri, TagMutator mutator, Promise promise) {
    ContentResolver resolver = getReactApplicationContext().getContentResolver();
    File temp = null;
    try {
      temp = File.createTempFile("af_tag_", ".tmp", getReactApplicationContext().getCacheDir());
      try (InputStream in = resolver.openInputStream(audioUri);
           OutputStream out = new FileOutputStream(temp)) {
        copyStream(in, out);
      }

      AudioFile audioFile = AudioFileIO.read(temp);
      Tag tag = audioFile.getTagOrCreateAndSetDefault();
      mutator.mutate(audioFile, tag);
      audioFile.commit();

      // 注意：openOutputStream(audioUri, "wt") 会先截断原文件再写入，写入中途失败会损坏原文件。
      // content:// URI 无法做原子 rename，故此处采用先把完整修改写入临时文件、再整体覆盖写回的策略，
      // 以降低（但无法完全消除）损坏风险。
      try (InputStream in = new FileInputStream(temp);
           OutputStream out = resolver.openOutputStream(audioUri, "wt")) {
        copyStream(in, out);
      }
      promise.resolve(true);
    } catch (SecurityException securityError) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
          && securityError instanceof android.app.RecoverableSecurityException) {
        requestWriteAccess(audioUri, mutator, promise);
      } else {
        promise.reject("LOCAL_MUSIC_TAG_WRITE_FAILED", securityError);
      }
    } catch (Exception error) {
      promise.reject("LOCAL_MUSIC_TAG_WRITE_FAILED", error);
    } finally {
      if (temp != null && temp.exists()) {
        //noinspection ResultOfMethodCallIgnored
        temp.delete();
      }
    }
  }

  private void handleUpdateAccessResult(int resultCode) {
    PendingMetadataUpdate pending = updatePending;
    updatePending = null;
    if (pending == null || pending.promise == null) {
      return;
    }
    if (resultCode != Activity.RESULT_OK) {
      pending.promise.reject("WRITE_DENIED", "用户拒绝了修改媒体文件的授权");
      return;
    }
    ContentResolver resolver = getReactApplicationContext().getContentResolver();
    try {
      int rows = resolver.update(pending.audioUri, pending.values, null, null);
      pending.promise.resolve(rows);
    } catch (Exception error) {
      pending.promise.reject("LOCAL_MUSIC_UPDATE_FAILED", error);
    }
  }

  private void requestUpdateAccess(Uri audioUri, ContentValues values, Promise promise) {
    if (updatePending != null) {
      promise.reject("WRITE_BUSY", "已有写入授权请求进行中，请稍后再试");
      return;
    }
    Activity activity = getCurrentActivity();
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "无法发起写入授权：当前没有可用的 Android Activity");
      return;
    }
    try {
      PendingIntent pendingIntent = MediaStore.createWriteRequest(
          getReactApplicationContext().getContentResolver(),
          Collections.singletonList(audioUri));
      updatePending = new PendingMetadataUpdate(audioUri, new ContentValues(values), promise);
      activity.startIntentSenderForResult(
          pendingIntent.getIntentSender(), REQUEST_UPDATE_AUDIO, null, 0, 0, 0);
    } catch (Exception error) {
      updatePending = null;
      promise.reject("WRITE_REQUEST_FAILED", error);
    }
  }

  private void requestWriteAccess(Uri audioUri, TagMutator mutator, Promise promise) {
    if (writePending != null) {
      promise.reject("WRITE_BUSY", "已有写入授权请求进行中，请稍后再试");
      return;
    }
    Activity activity = getCurrentActivity();
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "无法发起写入授权：当前没有可用的 Android Activity");
      return;
    }
    try {
      PendingIntent pendingIntent = MediaStore.createWriteRequest(
          getReactApplicationContext().getContentResolver(),
          Collections.singletonList(audioUri));
      writePending = new PendingWrite(audioUri, mutator, promise);
      activity.startIntentSenderForResult(
          pendingIntent.getIntentSender(), REQUEST_WRITE_AUDIO, null, 0, 0, 0);
    } catch (Exception error) {
      writePending = null;
      promise.reject("WRITE_REQUEST_FAILED", error);
    }
  }

  private static String safeString(Cursor cursor, int columnIndex) {
    if (cursor.isNull(columnIndex)) {
      return "";
    }
    return cursor.getString(columnIndex);
  }

  private static byte[] readAllBytes(ContentResolver resolver, Uri uri) throws Exception {
    try (InputStream in = resolver.openInputStream(uri)) {
      if (in == null) {
        return null;
      }
      java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
      byte[] chunk = new byte[8192];
      int read;
      while ((read = in.read(chunk)) != -1) {
        buffer.write(chunk, 0, read);
      }
      return buffer.toByteArray();
    }
  }

  private static void copyStream(InputStream in, OutputStream out) throws Exception {
    byte[] buffer = new byte[8192];
    int read;
    while ((read = in.read(buffer)) != -1) {
      out.write(buffer, 0, read);
    }
  }
}
