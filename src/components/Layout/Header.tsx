import { FormEvent, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Moon, Search, Sun } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useThemeStore } from "@/stores/themeStore";
import { IconButton } from "../IconButton";

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { effectiveTheme, setTheme } = useThemeStore();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (location.pathname === "/search") {
      setQuery(searchParams.get("q") ?? "");
    }
  }, [location.pathname, searchParams]);

  function toggleTheme() {
    setTheme(effectiveTheme === "dark" ? "light" : "dark");
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      navigate("/search");
      return;
    }
    navigate(`/search?q=${encodeURIComponent(trimmed)}`);
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
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索歌曲、歌手、歌单"
          className="af-header-search-input"
        />
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
