import { BarChart3, Home, Search, Settings, User, Music, ListMusic, Download, Calendar, Radio } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
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
  { to: "/playlists", icon: ListMusic, label: "歌单" },
  { to: "/downloads", icon: Download, label: "下载" },
  { to: "/local", icon: Music, label: "本地音乐" },
  { to: "/stats", icon: BarChart3, label: "听歌统计" },
];

export function Sidebar() {
  const { account, load } = useWyAccountStore();
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    getWyCookie().then((c) => load(c)).catch(() => {});
  }, []);

  return (
    <aside className="af-sidebar">
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
      <WyCookieLoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </aside>
  );
}
