import { useEffect, useRef, useState } from "react";
import {
  Cloud,
  Database,
  Info,
  Mic2,
  Music2,
  Palette,
  Settings2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import logoImg from "@/assets/logo.png";
import { DesktopLyricSettingsSection } from "@/views/settings/DesktopLyricSettingsSection";
import { AppearanceSettingsSection } from "@/views/settings/AppearanceSettingsSection";
import { DataSettingsSection } from "@/views/settings/DataSettingsSection";
import { MiscSettingsSection } from "@/views/settings/MiscSettingsSection";
import { PlaybackSettingsSection } from "@/views/settings/PlaybackSettingsSection";
import { SourcesSettingsSection } from "@/views/settings/SourcesSettingsSection";
import { SyncSettingsSection } from "@/views/settings/SyncSettingsSection";
import { useSettingsViewModel } from "@/views/useSettingsViewModel";
import { readAppVersion } from "@/services/updateService";

type SettingsSectionId =
  | "appearance"
  | "playback"
  | "sources"
  | "desktop-lyric"
  | "data"
  | "sync"
  | "misc"
  | "about";

interface SettingsTab {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
}

/** 顶部标签栏的分类顺序即 Tab 顺序 */
const SETTINGS_TABS: SettingsTab[] = [
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
  /** 真实版本号从 Tauri 侧读（updateService 已封装同一来源）；拿不到就显示「未知」，不再硬编码。 */
  const [appVersion, setAppVersion] = useState("");
  /** Tab 按钮引用：方向键切换后把焦点落到新选中的 Tab 上 */
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const model = useSettingsViewModel();
  const getActiveSettingsSection = (id: SettingsSectionId) => activeSection === id;

  useEffect(() => {
    let disposed = false;
    readAppVersion()
      .then((version) => {
        if (!disposed) setAppVersion(version);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

  /** 左右方向键在 Tab 间循环移动，Home / End 直达首尾；移动即选中，与点击行为一致 */
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = SETTINGS_TABS.findIndex((tab) => tab.id === activeSection);
    const lastIndex = SETTINGS_TABS.length - 1;
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = currentIndex < 0 || currentIndex === lastIndex ? 0 : currentIndex + 1;
        break;
      case "ArrowLeft":
        nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = lastIndex;
        break;
      default:
        return;
    }
    event.preventDefault();
    setActiveSection(SETTINGS_TABS[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="af-settings-view af-animate-slide-in">
      <div className="af-settings-page-head">
        <div>
          <h1 className="af-settings-title">设置</h1>
          <p className="af-settings-subtitle">管理播放、音源、桌面歌词和数据同步。</p>
        </div>
      </div>

      <div
        className="af-settings-tabs"
        role="tablist"
        aria-label="设置分类"
        onKeyDown={handleTabKeyDown}
      >
        {SETTINGS_TABS.map(({ id, label, icon: Icon }, index) => {
          const isActive = activeSection === id;
          return (
            <button
              key={id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`af-settings-tab-${id}`}
              className={`af-settings-tab ${isActive ? "af-active" : ""}`}
              aria-selected={isActive}
              aria-controls="af-settings-panel"
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveSection(id)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div
        key={activeSection}
        className="af-settings-panel"
        id="af-settings-panel"
        role="tabpanel"
        aria-labelledby={`af-settings-tab-${activeSection}`}
      >
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
          <p className="af-settings-about-version">{appVersion ? `版本 ${appVersion}` : "版本 未知"}</p>
          <p className="af-settings-about-description">
            现代化的跨平台音乐播放器，基于 Tauri + React 构建。
          </p>
        </div>
      </section>
      )}
      </div>
    </div>
  );
}
