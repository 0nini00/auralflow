import { useState } from "react";
import {
  Cloud,
  Database,
  Info,
  Mic2,
  Music2,
  Palette,
  Settings2,
} from "lucide-react";
import logoImg from "@/assets/logo.png";
import { DesktopLyricSettingsSection } from "@/views/settings/DesktopLyricSettingsSection";
import { AppearanceSettingsSection } from "@/views/settings/AppearanceSettingsSection";
import { DataSettingsSection } from "@/views/settings/DataSettingsSection";
import { MiscSettingsSection } from "@/views/settings/MiscSettingsSection";
import { PlaybackSettingsSection } from "@/views/settings/PlaybackSettingsSection";
import { SourcesSettingsSection } from "@/views/settings/SourcesSettingsSection";
import { SyncSettingsSection } from "@/views/settings/SyncSettingsSection";
import { useSettingsViewModel } from "@/views/useSettingsViewModel";

type SettingsSectionId =
  | "appearance"
  | "playback"
  | "sources"
  | "desktop-lyric"
  | "data"
  | "sync"
  | "misc"
  | "about";

const SETTINGS_NAV = [
  { id: "appearance", label: "外观", icon: Palette },
  { id: "playback", label: "播放", icon: Music2 },
  { id: "sources", label: "音源", icon: Settings2 },
  { id: "desktop-lyric", label: "桌面歌词", icon: Mic2 },
  { id: "data", label: "数据", icon: Database },
  { id: "sync", label: "同步", icon: Cloud },
  { id: "misc", label: "其他", icon: Settings2 },
  { id: "about", label: "关于", icon: Info },
];

export function SettingsView() {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");
  const model = useSettingsViewModel();
  const getActiveSettingsSection = (id: SettingsSectionId) => activeSection === id;

  return (
    <div className="af-settings-view af-animate-slide-in">
      <div className="af-settings-page-head">
        <div>
          <h1 className="af-settings-title">设置</h1>
          <p className="af-settings-subtitle">管理播放、音源、桌面歌词和数据同步。</p>
        </div>
      </div>

      <div className="af-settings-shell">
        <nav className="af-settings-nav" aria-label="设置分类">
          {SETTINGS_NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`af-settings-nav-link ${activeSection === id ? "af-active" : ""}`}
              onClick={() => setActiveSection(id as SettingsSectionId)}
              aria-current={activeSection === id ? "page" : undefined}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="af-settings-content">
          <div className="af-settings-panel">

      {getActiveSettingsSection("appearance") && <AppearanceSettingsSection model={model} />}

      {getActiveSettingsSection("playback") && <PlaybackSettingsSection model={model} />}

      {getActiveSettingsSection("sources") && <SourcesSettingsSection model={model} />}

      {/* Desktop Lyric Section */}
      {getActiveSettingsSection("desktop-lyric") && <DesktopLyricSettingsSection />}

      {getActiveSettingsSection("data") && <DataSettingsSection model={model} />}

      {/* Sync Section */}
      {getActiveSettingsSection("sync") && <SyncSettingsSection />}

      {/* Misc Section */}
      {getActiveSettingsSection("misc") && <MiscSettingsSection />}

      {/* About Section */}
      {getActiveSettingsSection("about") && (
      <section className="af-settings-section" id="about">
        <h2 className="af-settings-section-title">关于</h2>

        <div className="af-settings-about">
          <div className="af-settings-about-logo">
            <img src={logoImg} alt="AuralFlow" />
          </div>
          <h3 className="af-settings-about-title">AuralFlow</h3>
          <p className="af-settings-about-version">版本 0.1.0</p>
          <p className="af-settings-about-description">
            现代化的跨平台音乐播放器，基于 Tauri + React 构建。
          </p>
        </div>
      </section>
      )}
          </div>
        </div>
      </div>
    </div>
  );
}
