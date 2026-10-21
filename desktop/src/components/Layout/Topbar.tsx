import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Moon, PanelRight, Search, Square, Sun, X } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  buildSearchSuggestions,
  fetchWySearchSuggestions,
  mergeSearchSuggestions,
  recordSearchKeyword,
  type SearchSuggestion,
} from "@/services/search/searchSuggestions";
import { useThemeStore } from "@/stores/themeStore";
import { useUiStore } from "@/stores/uiStore";
import { runWindowCommand, useWindowDrag } from "@/hooks/useWindowDrag";
import { IconButton } from "../IconButton";

/** 路由 → 面包屑末级文案。详情页不读数据，只给类别名，避免顶栏依赖各页 store。 */
const ROUTE_LABELS: Record<string, string> = {
  "/": "发现音乐",
  "/search": "搜索",
  "/charts": "排行榜",
  "/playlist-square": "歌单广场",
  "/daily": "每日推荐",
  "/fm": "私人 FM",
  "/cloud": "音乐云盘",
  "/playlists": "我的歌单",
  "/downloads": "下载",
  "/local": "本地音乐",
  "/history": "最近播放",
  "/stats": "听歌统计",
  "/settings": "设置",
};

function resolveRouteLabel(pathname: string): string {
  const exact = ROUTE_LABELS[pathname];
  if (exact) return exact;
  if (pathname.startsWith("/playlist/")) return "歌单";
  if (pathname.startsWith("/artist/")) return "歌手";
  if (pathname.startsWith("/album/")) return "专辑";
  return "AuralFlow";
}

export function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { effectiveTheme, setTheme } = useThemeStore();
  const panelOpen = useUiStore((s) => s.nowPlayingOpen);
  const togglePanel = useUiStore((s) => s.toggleNowPlaying);
  const [query, setQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [onlineSuggestions, setOnlineSuggestions] = useState<{ query: string; items: SearchSuggestion[] }>({ query: "", items: [] });
  const [activeIndex, setActiveIndex] = useState(-1);
  const composingRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const drag = useWindowDrag();
  const listboxId = useId();
  const localSuggestions = useMemo(() => buildSearchSuggestions(query), [query]);
  const suggestions = useMemo(
    () => mergeSearchSuggestions(onlineSuggestions.query === query ? onlineSuggestions.items : [], localSuggestions),
    [localSuggestions, onlineSuggestions, query],
  );
  const canShowSuggestions = suggestionsOpen && query.trim().length > 0 && suggestions.length > 0;
  const routeLabel = resolveRouteLabel(location.pathname);

  useEffect(() => {
    if (location.pathname === "/search") {
      setQuery(searchParams.get("q") ?? "");
      setActiveIndex(-1);
    }
  }, [location.pathname, searchParams]);

  // Ctrl/Cmd + K 聚焦搜索：桌面播放器的通行约定，避免用户去点那个小框
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    // 失效标记属于本次查询；查询关联的结果也不会短暂出现在新查询下面。
    let current = true;
    const timer = window.setTimeout(() => {
      fetchWySearchSuggestions(trimmed)
        .then((items) => {
          if (current) { setOnlineSuggestions({ query, items }); setActiveIndex(-1); }
        })
        .catch(() => {
          if (current) setOnlineSuggestions({ query, items: [] });
        });
    }, 220);
    return () => { current = false; window.clearTimeout(timer); };
  }, [query]);

  function toggleTheme() {
    setTheme(effectiveTheme === "dark" ? "light" : "dark");
  }

  function submitSearch(term: string) {
    setSuggestionsOpen(false);
    setActiveIndex(-1);
    const trimmed = term.trim();
    if (!trimmed) {
      navigate("/search");
      return;
    }

    recordSearchKeyword(trimmed);
    setQuery(trimmed);
    navigate(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composingRef.current) return;
    submitSearch(query);
  }

  function handleBlur(event: React.FocusEvent<HTMLFormElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setSuggestionsOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.defaultPrevented || composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && canShowSuggestions) {
      event.preventDefault();
      setSuggestionsOpen(false);
      setActiveIndex(-1);
      return;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length) {
      event.preventDefault();
      setSuggestionsOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => {
        if (!canShowSuggestions || index < 0) return step > 0 ? 0 : suggestions.length - 1;
        return (index + step + suggestions.length) % suggestions.length;
      });
      return;
    }
    if (event.key === "Enter" && canShowSuggestions && activeIndex >= 0) {
      event.preventDefault();
      submitSearch(suggestions[activeIndex].value);
    }
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    setActiveIndex(-1);
    setSuggestionsOpen(true);
  }

  return (
    <header className="af-topbar" onMouseDown={drag.onMouseDown} onDoubleClick={drag.onDoubleClick}>
      <div className="af-topbar-nav">
        <IconButton icon={ChevronLeft} ariaLabel="后退" size="sm" onClick={() => navigate(-1)} />
        <IconButton icon={ChevronRight} ariaLabel="前进" size="sm" onClick={() => navigate(1)} />
      </div>

      <nav className="af-topbar-crumbs" aria-label="位置">
        {location.pathname !== "/" && (
          <>
            <Link to="/" className="af-crumb">首页</Link>
            <span className="af-crumb-sep" aria-hidden="true">/</span>
          </>
        )}
        <span className="af-crumb-current" aria-current="page">{routeLabel}</span>
      </nav>

      <form className="af-topbar-search" role="search" onSubmit={handleSearchSubmit} onBlur={handleBlur}>
        <Search size={15} aria-hidden="true" />
        <label htmlFor="af-global-search" className="af-sr-only">
          搜索音乐
        </label>
        <input
          ref={searchInputRef}
          id="af-global-search"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={canShowSuggestions}
          aria-controls={canShowSuggestions ? listboxId : undefined}
          aria-activedescendant={canShowSuggestions && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          onFocus={() => setSuggestionsOpen(true)}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={handleKeyDown}
          placeholder="搜索歌曲、歌手、专辑"
          className="af-topbar-search-input"
          autoComplete="off"
        />
        <kbd className="af-topbar-kbd">Ctrl K</kbd>
        {canShowSuggestions && (
          <div id={listboxId} className="af-header-search-popover af-search-suggestions" role="listbox" aria-label="搜索联想">
            {suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.type}:${suggestion.value}`}
                type="button"
                role="option"
                id={`${listboxId}-${index}`}
                aria-selected={activeIndex === index}
                tabIndex={-1}
                style={activeIndex === index ? { background: "var(--af-bg-surface-hover)" } : undefined}
                className="af-search-suggestion-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => submitSearch(suggestion.value)}
              >
                <span>{suggestion.label}</span>
                <small>{suggestion.meta}</small>
              </button>
            ))}
          </div>
        )}
      </form>

      <div className="af-topbar-actions">
        <IconButton
          icon={PanelRight}
          ariaLabel={panelOpen ? "隐藏正在播放面板" : "显示正在播放面板"}
          size="sm"
          active={panelOpen}
          onClick={togglePanel}
        />
        <IconButton
          icon={effectiveTheme === "dark" ? Sun : Moon}
          ariaLabel={effectiveTheme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          size="sm"
          onClick={toggleTheme}
        />
        <div className="af-topbar-divider" aria-hidden="true" />
        <button
          type="button"
          className="af-window-control"
          onClick={() => runWindowCommand((win) => win.minimize())}
          aria-label="最小化窗口"
        >
          <Minus size={14} strokeWidth={2.4} />
        </button>
        <button
          type="button"
          className="af-window-control"
          onClick={() => runWindowCommand((win) => win.toggleMaximize())}
          aria-label="最大化或还原窗口"
        >
          <Square size={12} strokeWidth={2.2} />
        </button>
        <button
          type="button"
          className="af-window-control af-window-control-close"
          onClick={() => runWindowCommand((win) => win.close())}
          aria-label="关闭窗口"
        >
          <X size={15} strokeWidth={2.3} />
        </button>
      </div>
    </header>
  );
}
