import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { LocalSong } from "@/services/localMusicService";
import {
  setAudioMetadata,
  setAudioCover,
  setAudioLyrics,
  getAudioInfo,
} from "@lx/tauri-bridge";
import { useLibraryStore } from "@/stores/libraryStore";
import { logAsyncError } from "@/utils/logAsyncError";

interface Props {
  song: LocalSong | null;
  onClose: () => void;
}

export function MetadataEditModal({ song, onClose }: Props) {
  const updateSong = useLibraryStore((s) => s.updateSong);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [coverData, setCoverData] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (song) {
      setTitle(song.title ?? "");
      setArtist(song.artist ?? "");
      setAlbum(song.album ?? "");
      setLyrics("");
      setCoverData(null);
      setError("");
      // 拉取一次完整信息（含内嵌歌词）
      getAudioInfo(song.path)
        .then((info) => setLyrics(info.lyrics ?? ""))
        .catch(logAsyncError("metadata:reload-audio-info"));
    }
  }, [song]);

  if (!song) return null;

  const handlePickCover = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCoverData(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await setAudioMetadata(song.path, { title, artist, album });
      if (coverData) {
        await setAudioCover(song.path, coverData);
      }
      await setAudioLyrics(song.path, lyrics);
      const refreshed = await getAudioInfo(song.path);
      updateSong(song.id, {
        title: refreshed.title,
        artist: refreshed.artist,
        album: refreshed.album,
        cover: refreshed.cover_data ?? undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="af-dialog-overlay" onClick={onClose}>
      <div className="af-dialog af-metadata-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="af-metadata-header">
          <h2>编辑元数据</h2>
          <button className="af-menu-trigger" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="af-dialog-body">
          <div className="af-metadata-cover-row">
            <div className="af-metadata-cover">
              {coverData ?? song.cover ? (
                <img src={coverData ?? song.cover} alt="cover" />
              ) : (
                <div className="af-cover-placeholder">♪</div>
              )}
            </div>
            <div className="af-metadata-cover-actions">
              <button
                type="button"
                className="af-settings-small-button"
                onClick={() => fileInputRef.current?.click()}
              >
                更换封面
              </button>
              {coverData && (
                <button
                  type="button"
                  className="af-settings-small-button"
                  onClick={() => setCoverData(null)}
                >
                  撤销
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePickCover}
                style={{ display: "none" }}
              />
            </div>
          </div>

          <div className="af-form-group">
            <label>标题</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="af-form-group">
            <label>艺术家</label>
            <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)} />
          </div>
          <div className="af-form-group">
            <label>专辑</label>
            <input type="text" value={album} onChange={(e) => setAlbum(e.target.value)} />
          </div>
          <div className="af-form-group">
            <label>歌词</label>
            <textarea
              className="af-settings-textarea"
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder="LRC 或纯文本歌词，留空清除"
              rows={6}
            />
          </div>
          <p className="af-settings-hint">
            直接写入文件标签：标题/艺术家/专辑（audiotags）、封面、歌词（lofty USLT/Vorbis）。
          </p>
          {error && <p className="af-settings-error">{error}</p>}
        </div>

        <div className="af-dialog-actions">
          <button className="af-btn-secondary" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            className="af-btn-primary"
            onClick={handleSave}
            disabled={saving || !title.trim()}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
