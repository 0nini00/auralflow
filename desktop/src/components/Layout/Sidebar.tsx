import { BarChart3, Cloud, Home, Search, Settings, User, Music, ListMusic, Download, Calendar, Radio } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
// 与 DOM 的全局 PointerEvent 同名，这里按别名引入 React 的事件类型。
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { loadSettings, patchSettings } from "@lx/tauri-bridge";
import { useWyAccountStore } from "@/stores/wyAccountStore";
import { getWyCookie } from "@/services/wyAccountService";
import { WyCookieLoginModal } from "@/components/WyCookieLoginModal";
import logoImg from "@/assets/logo.png";

/** 侧边栏导航项；requiresAccount 表示该入口完全由网易云账号提供，未登录时不渲染 */
interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  requiresAccount?: boolean;
}

const navItems: NavItem[] = [
  { to: "/", icon: Home, label: "发现" },
  { to: "/search", icon: Search, label: "搜索" },
  { to: "/daily", icon: Calendar, label: "每日推荐", requiresAccount: true },
  { to: "/fm", icon: Radio, label: "私人 FM", requiresAccount: true },
  { to: "/cloud", icon: Cloud, label: "音乐云盘", requiresAccount: true },
  { to: "/playlists", icon: ListMusic, label: "歌单" },
  { to: "/downloads", icon: Download, label: "下载" },
  { to: "/local", icon: Music, label: "本地音乐" },
  { to: "/stats", icon: BarChart3, label: "听歌统计" },
];

const SIDEBAR_DEFAULT_WIDTH = 240;
/** 下限按「图标 + 汉字标签 + 内边距」估：再窄就会把「听歌统计」挤成两行。 */
const SIDEBAR_MIN_WIDTH = 200;
/** 上限留出内容区：1360 的设计窗口下侧栏超过 360 后，歌单列表的多列会被压扁。 */
const SIDEBAR_MAX_WIDTH = 360;
/** 键盘微调步长。 */
const SIDEBAR_KEY_STEP = 8;

function clampSidebarWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

export function Sidebar() {
  const { account, load } = useWyAccountStore();
  const [loginOpen, setLoginOpen] = useState(false);
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const widthRef = useRef(width);
  widthRef.current = width;
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    getWyCookie().then((c) => load(c)).catch(() => {});
  }, []);

  // 宽度是用户偏好，跟着设置落盘；读不到（例如浏览器里的纯 UI 调试）就用默认值。
  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then((settings) => {
        if (!cancelled) setWidth(clampSidebarWidth(settings.sidebarWidth));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const persistWidth = useCallback((next: number) => {
    void patchSettings({ sidebarWidth: next }).catch(() => undefined);
  }, []);

  const stopDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.body.classList.remove("af-resizing-sidebar");
    // 只在拖拽结束时写盘：拖动过程中每像素写一次设置会把磁盘打满。
    persistWidth(widthRef.current);
  }, [persistWidth]);

  // 监听挂在 window 上：鼠标拖出把手（甚至拖出窗口）时仍要跟手，直到抬起。
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setWidth(clampSidebarWidth(drag.startWidth + (event.clientX - drag.startX)));
    };
    const onPointerUp = () => stopDrag();
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [stopDrag]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: widthRef.current };
    document.body.classList.add("af-resizing-sidebar");
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = widthRef.current - SIDEBAR_KEY_STEP;
    else if (event.key === "ArrowRight") next = widthRef.current + SIDEBAR_KEY_STEP;
    else if (event.key === "Home") next = SIDEBAR_DEFAULT_WIDTH;
    if (next == null) return;
    event.preventDefault();
    const clamped = clampSidebarWidth(next);
    setWidth(clamped);
    persistWidth(clamped);
  };

  return (
    <aside className="af-sidebar" style={{ width }}>
      <div className="af-sidebar-header">
        <div className="af-logo">
          <div className="af-logo-icon">
            <img src={logoImg} alt="AuralFlow" className="af-logo-img" />
          </div>
          <span className="af-logo-text">AuralFlow</span>
        </div>
      </div>

      <nav className="af-sidebar-nav" aria-label="主导航">
        {navItems
          .filter((item) => !item.requiresAccount || account)
          .map((item) => (
            <NavLink key={item.to} to={item.to} className="af-sidebar-link" end={item.to === "/"}>
              <item.icon size={20} strokeWidth={2} />
              <span>{item.label}</span>
            </NavLink>
          ))}
      </nav>

      <div className="af-sidebar-footer">
        <NavLink to="/settings" className="af-sidebar-link">
          <Settings size={20} strokeWidth={2} />
          <span>设置</span>
        </NavLink>
        <button
          type="button"
          className="af-user-button"
          aria-label={account ? `网易云账号：${account.nickname}` : "登录网易云账号"}
          onClick={() => setLoginOpen(true)}
          title={account ? "管理网易云账号" : "点击登录网易云账号"}
        >
          {account?.avatarUrl ? (
            <img src={account.avatarUrl} alt="" className="af-user-avatar" />
          ) : (
            <User size={18} strokeWidth={2} />
          )}
          <span>{account ? account.nickname : "未登录"}</span>
        </button>
      </div>

      {/*
        拖拽把手：热区 8px 贴在右内边缘。不放在 aside 外面是因为 `.af-sidebar`
        有 overflow:hidden，负偏移会被裁掉。
        双击复位默认宽度；键盘左右键按 8px 微调，Home 复位。
      */}
      <div
        className="af-sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧边栏宽度"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onDoubleClick={() => {
          setWidth(SIDEBAR_DEFAULT_WIDTH);
          persistWidth(SIDEBAR_DEFAULT_WIDTH);
        }}
        onKeyDown={handleKeyDown}
      />

      <WyCookieLoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </aside>
  );
}
