import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
import { logAsyncError } from "@/utils/logAsyncError";
import { IconButton } from "../IconButton";

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { effectiveTheme, setTheme } = useThemeStore();
  const [query, setQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [onlineSuggestions, setOnlineSuggestions] = useState<SearchSuggestion[]>([]);
  const blurTimerRef = useRef<number | null>(null);
  const suggestRequestSeqRef = useRef(0);
  const localSuggestions = useMemo(() => buildSearchSuggestions(query), [query]);
  const suggestions = useMemo(
    () => mergeSearchSuggestions(onlineSuggestions, localSuggestions),
    [localSuggestions, onlineSuggestions],
  );
  const canShowSuggestions = suggestionsOpen && query.trim().length > 0 && suggestions.length > 0;

  useEffect(() => {
    if (location.pathname === "/search") {
      setQuery(searchParams.get("q") ?? "");
    }
  }, [location.pathname, searchParams]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) {
        window.clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    const requestId = suggestRequestSeqRef.current + 1;
    suggestRequestSeqRef.current = requestId;

    if (trimmed.length < 2) {
      setOnlineSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      fetchWySearchSuggestions(trimmed)
        .then((items) => {
          if (requestId === suggestRequestSeqRef.current) {
            setOnlineSuggestions(items);
          }
        })
        .catch((error) => {
          if (requestId === suggestRequestSeqRef.current) {
            setOnlineSuggestions([]);
          }
          logAsyncError("search:suggest:header")(error);
        });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [query]);

  function toggleTheme() {
    setTheme(effectiveTheme === "dark" ? "light" : "dark");
  }

  function submitSearch(term: string) {
    setSuggestionsOpen(false);
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
    submitSearch(query);
  }

  function handleBlur() {
    blurTimerRef.current = window.setTimeout(() => setSuggestionsOpen(false), 120);
  }

  function handleSuggestionClick(value: string) {
    submitSearch(value);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setSuggestionsOpen(false);
      event.currentTarget.blur();
    }
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    setSuggestionsOpen(true);
  }

  function handleFocus() {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
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

      <form className="af-header-search" role="search" onSubmit={handleSearchSubmit}>
        <Search size={16} aria-hidden="true" />
        <label htmlFor="af-global-search" className="af-sr-only">
          搜索音乐
        </label>
        <input
          id="af-global-search"
          type="search"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="搜索歌曲、歌手、专辑"
          className="af-header-search-input"
          autoComplete="off"
        />
        {canShowSuggestions && (
          <div className="af-header-search-popover af-search-suggestions" role="listbox" aria-label="搜索联想">
            {suggestions.map((suggestion) => (
              <button
                key={`${suggestion.type}:${suggestion.value}`}
                type="button"
                className="af-search-suggestion-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleSuggestionClick(suggestion.value)}
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
