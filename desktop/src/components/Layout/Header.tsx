import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Moon, Search, Sun } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  buildSearchSuggestions,
  fetchWySearchSuggestions,
  mergeSearchSuggestions,
  recordSearchKeyword,
  type SearchSuggestion,
} from "@/services/search/searchSuggestions";
import { useThemeStore } from "@/stores/themeStore";
import { IconButton } from "../IconButton";

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { effectiveTheme, setTheme } = useThemeStore();
  const [query, setQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [onlineSuggestions, setOnlineSuggestions] = useState<{ query: string; items: SearchSuggestion[] }>({ query: "", items: [] });
  const [activeIndex, setActiveIndex] = useState(-1);
  const composingRef = useRef(false);
  const listboxId = useId();
  const localSuggestions = useMemo(() => buildSearchSuggestions(query), [query]);
  const suggestions = useMemo(
    () => mergeSearchSuggestions(onlineSuggestions.query === query ? onlineSuggestions.items : [], localSuggestions),
    [localSuggestions, onlineSuggestions, query],
  );
  const canShowSuggestions = suggestionsOpen && query.trim().length > 0 && suggestions.length > 0;

  useEffect(() => {
    if (location.pathname === "/search") {
      setQuery(searchParams.get("q") ?? "");
      setActiveIndex(-1);
    }
  }, [location.pathname, searchParams]);

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
    <header className="af-header">
      <div className="af-header-left">
        <IconButton
          icon={ChevronLeft}
          ariaLabel="后退"
          size="sm"
          onClick={() => navigate(-1)}
        />
        <IconButton
          icon={ChevronRight}
          ariaLabel="前进"
          size="sm"
          onClick={() => navigate(1)}
        />
      </div>

      <form className="af-header-search" role="search" onSubmit={handleSearchSubmit} onBlur={handleBlur}>
        <Search size={16} aria-hidden="true" />
        <label htmlFor="af-global-search" className="af-sr-only">
          搜索音乐
        </label>
        <input
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
          className="af-header-search-input"
          autoComplete="off"
        />
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

      <div className="af-header-right">
        <IconButton
          icon={effectiveTheme === "dark" ? Sun : Moon}
          ariaLabel={effectiveTheme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          size="sm"
          onClick={toggleTheme}
        />
      </div>
    </header>
  );
}
