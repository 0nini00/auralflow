import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  ChevronLeft,
  ChevronRight,
  Menu,
  Moon,
  Search as SearchIcon,
  Sun,
} from "lucide-react-native";

import { Touchable } from "@/components/Touchable";
import {
  getSearchSuggestions,
  type SearchSuggestion,
} from "@/services/searchSuggestionService";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { layout, radius, spacing, touch, typography } from "@/theme/tokens";

export interface AppHeaderProps {
  canGoBack: boolean;
  canGoForward: boolean;
  onOpenDrawer: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onSubmitSearch: (keyword: string) => void;
  seedQuery?: string;
}

export function AppHeader({
  canGoBack,
  canGoForward,
  onOpenDrawer,
  onGoBack,
  onGoForward,
  onSubmitSearch,
  seedQuery = "",
}: AppHeaderProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const setMode = useThemeStore((state) => state.setMode);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  const [query, setQuery] = useState(seedQuery);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(seedQuery);
  }, [seedQuery]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setSuggestions([]);
      setSuggestionError(null);
      return;
    }

    setSuggestionError(null);
    const timer = setTimeout(() => {
      void getSearchSuggestions(trimmed)
        .then((nextSuggestions) => {
          setSuggestions(nextSuggestions);
          setSuggestionError(null);
        })
        .catch((error: unknown) => {
          setSuggestions([]);
          const detail = error instanceof Error ? `：${error.message}` : "";
          setSuggestionError(`搜索建议加载失败${detail}`);
        });
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    return () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, []);

  const resolvedTheme = getResolvedTheme(mode, systemTheme);
  const ThemeIcon = resolvedTheme === "dark" ? Sun : Moon;
  const themeLabel = resolvedTheme === "dark" ? "切换到浅色模式" : "切换到深色模式";

  const submit = (raw: string) => {
    setOpen(false);
    onSubmitSearch(raw.trim());
  };

  const toggleTheme = () => {
    void setMode(resolvedTheme === "dark" ? "light" : "dark");
  };

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.bar,
          {
            backgroundColor: palette.surface,
            borderColor: palette.border,
          },
        ]}
      >
        <View style={styles.navigationActions}>
          <Touchable
            onPress={onOpenDrawer}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="打开菜单"
          >
            <Menu size={20} strokeWidth={2} color={palette.text} />
          </Touchable>
          <Touchable
            disabled={!canGoBack}
            onPress={onGoBack}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="后退"
          >
            <ChevronLeft
              size={20}
              strokeWidth={2}
              color={canGoBack ? palette.text : palette.textSubtle}
            />
          </Touchable>
          <Touchable
            disabled={!canGoForward}
            onPress={onGoForward}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="前进"
          >
            <ChevronRight
              size={20}
              strokeWidth={2}
              color={canGoForward ? palette.text : palette.textSubtle}
            />
          </Touchable>
        </View>

        <View
          style={[
            styles.search,
            {
              backgroundColor: palette.surfaceMuted,
              borderColor: palette.border,
            },
          ]}
        >
          <SearchIcon size={16} strokeWidth={2} color={palette.textSubtle} />
          <TextInput
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setOpen(true);
            }}
            onFocus={() => {
              if (blurTimer.current) {
                clearTimeout(blurTimer.current);
                blurTimer.current = null;
              }
              setOpen(true);
            }}
            onBlur={() => {
              blurTimer.current = setTimeout(() => setOpen(false), 140);
            }}
            onSubmitEditing={() => submit(query)}
            placeholder="搜索歌曲、歌手、专辑"
            placeholderTextColor={palette.textSubtle}
            returnKeyType="search"
            style={[styles.searchInput, { color: palette.text }]}
            accessibilityLabel="搜索音乐"
          />
        </View>

        <Touchable
          onPress={toggleTheme}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel={themeLabel}
        >
          <ThemeIcon size={20} strokeWidth={2} color={palette.text} />
        </Touchable>
      </View>

      {open && suggestionError ? (
        <View
          style={[
            styles.errorPopover,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
            },
          ]}
        >
          <Text style={[styles.errorText, { color: palette.text }]}>{suggestionError}</Text>
        </View>
      ) : open && suggestions.length > 0 ? (
        <View
          style={[
            styles.popover,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
            },
          ]}
        >
          <FlatList
            keyboardShouldPersistTaps="handled"
            data={suggestions.slice(0, 8)}
            keyExtractor={(item, index) => `${item.type}:${item.keyword}:${index}`}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  styles.suggestionRow,
                  pressed && { backgroundColor: palette.surfaceMuted },
                ]}
                onPress={() => {
                  setQuery(item.keyword);
                  submit(item.keyword);
                }}
              >
                <Text style={[styles.suggestionLabel, { color: palette.text }]} numberOfLines={1}>
                  {item.keyword}
                </Text>
                <Text
                  style={[styles.suggestionMeta, { color: palette.textSubtle }]}
                  numberOfLines={1}
                >
                  {item.type}
                </Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    zIndex: 20,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
  },
  bar: {
    minHeight: layout.headerHeight,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  navigationActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconButton: {
    minWidth: touch.minTarget,
    minHeight: touch.minTarget,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    flex: 1,
    minWidth: 0,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: typography.body,
    paddingVertical: 0,
  },
  popover: {
    marginTop: 8,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: 280,
    overflow: "hidden",
  },
  errorPopover: {
    marginTop: 8,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorText: {
    fontSize: typography.caption,
  },
  suggestionRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  suggestionLabel: {
    flex: 1,
    fontSize: typography.body,
    fontWeight: "500",
  },
  suggestionMeta: {
    fontSize: typography.caption,
  },
});
