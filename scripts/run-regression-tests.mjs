import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function fileExists(path) {
  return existsSync(resolve(root, path));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(content, needle, label) {
  assert(content.includes(needle), `${label} should include ${needle}`);
}

function assertNotIncludes(content, needle, label) {
  assert(!content.includes(needle), `${label} should not include ${needle}`);
}

function assertFileMissing(path, label) {
  assert(!fileExists(path), `${label} should be removed: ${path}`);
}

function getCssRuleBlock(content, selector) {
  const start = content.indexOf(`${selector} {`);
  assert(start >= 0, `CSS should include ${selector}`);
  const bodyStart = content.indexOf("{", start) + 1;
  const bodyEnd = content.indexOf("\n}", bodyStart);
  assert(bodyEnd > bodyStart, `CSS block should close for ${selector}`);
  return content.slice(bodyStart, bodyEnd);
}

function assertCssRuleNotIncludes(content, selector, needle, label) {
  const block = getCssRuleBlock(content, selector);
  assertNotIncludes(block, needle, label);
}

function assertCssRuleIncludes(content, selector, needle, label) {
  const block = getCssRuleBlock(content, selector);
  assertIncludes(block, needle, label);
}

function loadTsModule(path) {
  const source = read(path);
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const exports = {};
  new Function("exports", output)(exports);
  return exports;
}

function testSearchLayoutContract() {
  const searchView = read("src/views/SearchView.tsx");
  const header = read("src/components/Layout/Header.tsx");
  const searchCss = read("src/styles/search.css");
  const layoutCss = read("src/styles/layout.css");
  const suggestions = read("src/services/search/searchSuggestions.ts");

  assertIncludes(searchView, 'type ResultFilter = "overview" | "song" | "artist" | "album" | "playlist"', "SearchView filters");
  assertIncludes(searchView, '{ id: "overview", label: "综合" }', "SearchView tabs");
  assertIncludes(searchView, '{ id: "playlist", label: "歌单" }', "SearchView tabs");
  assertNotIncludes(searchView, '{ id: "all", label: "全部" }', "SearchView tabs");
  assertIncludes(searchView, "showPlaylistResults", "SearchView playlist tab content");
  assertIncludes(searchView, "af-search-overview", "SearchView overview layout");
  assertIncludes(searchView, "af-search-suggestions", "SearchView suggestions");
  assertIncludes(header, "buildSearchSuggestions", "Header suggestions");
  assertIncludes(header, "fetchWySearchSuggestions", "Header online suggestions");
  assertIncludes(header, "recordSearchKeyword", "Header recent keywords");
  assertIncludes(searchView, "fetchWySearchSuggestions", "SearchView online suggestions");
  assertIncludes(searchCss, ".af-search-overview", "Search styles");
  assertIncludes(searchCss, ".af-search-suggestions", "Search suggestion styles");
  assertIncludes(layoutCss, ".af-header-search-popover", "Header suggestion styles");
  assertIncludes(suggestions, "buildSearchSuggestions", "Suggestion service");
  assertIncludes(suggestions, "fetchWySearchSuggestions", "Suggestion service");
  assertIncludes(suggestions, "recordSearchKeyword", "Suggestion service");
}

function testImmersiveLyricVisualizerModes() {
  const visualizerTypes = read("src/components/playerVisualizers/types.ts");
  const renderer = read("src/components/playerVisualizers/PlayerVisualizerRenderer.tsx");
  const overlay = read("src/components/ImmersiveLyricsOverlay.tsx");
  const playerBar = read("src/components/PlayerBar.tsx");
  const posterVisualizer = read("src/components/playerVisualizers/PosterLyricsVisualizer.tsx");
  const playerCss = read("src/styles/player.css");

  assertFileMissing("src/components/playerVisualizers/LyricsVisualizer.tsx", "Classic lyrics visualizer");
  assertFileMissing("src/components/playerVisualizers/registry.tsx", "Visualizer mode registry");
  assertNotIncludes(visualizerTypes, "PlayerVisualizerMode", "Visualizer mode type");
  assertIncludes(renderer, "PosterLyricsVisualizer", "Visualizer renderer");
  assertNotIncludes(renderer, "getPlayerVisualizer", "Visualizer renderer");
  assertNotIncludes(renderer, "defaultPlayerVisualizerMode", "Visualizer renderer");
  assertNotIncludes(overlay, "playerVisualizerRegistry", "Immersive lyrics mode switch");
  assertNotIncludes(overlay, "visualizerMode", "Immersive lyrics mode state");
  assertNotIncludes(overlay, "setVisualizerMode", "Immersive lyrics mode state");
  assertNotIncludes(overlay, "isClassicLyricsMode", "Immersive lyrics classic layout");
  assertIncludes(overlay, "af-immersive-visualizer-poster", "Immersive lyrics fixed poster mode");
  assertIncludes(overlay, "af-showcase-layout", "Immersive lyrics poster layout");
  assertIncludes(overlay, "defaultControlsHidden?: boolean", "Immersive lyrics default hidden prop");
  assertIncludes(overlay, "const controlsHidden = hidePlayerControls", "Immersive lyrics universal control hiding");
  assertIncludes(overlay, "aria-label=\"隐藏播放器控制栏\"", "Immersive lyrics hide control button");
  assertIncludes(overlay, "isPlaying={isPlaying}", "Immersive lyrics visualizer playback state");
  assertIncludes(overlay, "controlsHidden={controlsHidden}", "Immersive lyrics visualizer control hidden state");
  assertNotIncludes(overlay, "{isNativeFullscreen && (", "Immersive lyrics hide control button");
  assertIncludes(playerBar, "defaultControlsHidden={true}", "PlayerBar cover opens hidden controls");
  assertIncludes(visualizerTypes, "controlsHidden: boolean", "Visualizer props control hidden state");
  assertIncludes(posterVisualizer, "af-poster-lyric-panel", "Poster lyric panel layout");
  assertIncludes(posterVisualizer, "af-poster-bottom-wave", "Poster waveform bottom layout");
  assertIncludes(posterVisualizer, "controlsHidden &&", "Poster waveform only renders when controls are hidden");
  assertIncludes(posterVisualizer, "getSecondaryLyricText", "Poster uses two lyric lines");
  assertIncludes(posterVisualizer, "secondaryLyric &&", "Poster renders the second lyric line");
  assertNotIncludes(posterVisualizer, "showTranslation && currentLine?.tr", "Poster second line should fall back to next lyric");
  assertIncludes(posterVisualizer, "calculateLyricLineProgress", "Poster lyric progress");
  assertIncludes(posterVisualizer, "'--af-poster-lyric-progress'", "Poster lyric progress css variable");
  assertIncludes(posterVisualizer, "af-poster-wave-svg", "Poster continuous waveform svg");
  assertIncludes(posterVisualizer, "af-poster-wave-progress", "Poster lyrics waveform progress");
  assertNotIncludes(posterVisualizer, "af-poster-kicker", "Poster should not show album/source kicker");
  assertNotIncludes(playerCss, ".af-immersive-mode-switch", "Immersive lyrics mode switch styles");
  assertNotIncludes(playerCss, ".af-lyrics-viewport", "Classic lyrics scroll styles");
  assertNotIncludes(playerCss, ".af-lyric-line", "Classic lyrics scroll styles");
  assertNotIncludes(playerCss, "af-scroll-layout", "Classic lyrics layout styles");
  assertIncludes(playerCss, "--af-immersive-control-rest-bg: transparent", "Immersive controls blend into background");
  assertIncludes(playerCss, "background: var(--af-immersive-control-rest-bg)", "Immersive controls use blended rest background");
  assertIncludes(playerCss, "border-color: var(--af-immersive-control-rest-border)", "Immersive controls use blended rest border");
  assertIncludes(playerCss, ".af-poster-lyrics-visualizer", "Poster lyrics visualizer styles");
  assertIncludes(playerCss, ".af-poster-reference-panel", "Poster lyrics reference layout");
  assertIncludes(playerCss, "gap: clamp(44px, 5.4vw, 76px)", "Poster track info and lyrics should breathe");
  assertIncludes(playerCss, ".af-immersive-visualizer-poster .af-immersive-cover-glow", "Poster cover-driven background");
  assertIncludes(playerCss, ".af-poster-lyric-panel", "Poster lyric panel styles");
  assertCssRuleIncludes(playerCss, ".af-poster-track-copy", "font-family: var(--af-immersive-lyric-font-family", "Poster track info uses immersive lyric font");
  assertIncludes(playerCss, "--af-poster-lyric-progress", "Poster primary lyric progress style");
  assertIncludes(playerCss, "background-clip: text", "Poster primary lyric progress style");
  assertIncludes(playerCss, "color: transparent", "Poster primary lyric progress style");
  assertIncludes(playerCss, "user-select: none", "Poster lyric text should not show selection highlight");
  assertCssRuleNotIncludes(playerCss, ".af-poster-primary-lyric", "border", "Poster primary lyric should not look boxed");
  assertCssRuleNotIncludes(playerCss, ".af-poster-primary-lyric", "background:", "Poster primary lyric should not look boxed");
  assertIncludes(playerCss, ".af-poster-bottom-wave", "Poster bottom waveform styles");
  assertIncludes(playerCss, ".af-poster-wave-line", "Poster continuous waveform styles");
  assertCssRuleIncludes(playerCss, ".af-immersive-close", "background: transparent", "Immersive close button should blend into background");
  assertCssRuleIncludes(playerCss, ".af-immersive-restore-controls", "background: transparent", "Immersive restore button should blend into background");
  assertIncludes(playerCss, ".af-poster-lyrics-visualizer.af-playing .af-poster-wave-line", "Poster animated continuous waveform");
  assertNotIncludes(playerCss, ".af-poster-wave span", "Poster should not use bar waveform");
  assertNotIncludes(playerCss, ".af-immersive-visualizer-poster:not(.af-immersive-controls-hidden) .af-poster-bottom-wave", "Poster waveform should not be positioned for visible controls");
  assertNotIncludes(playerCss, "af-spectrum", "Spectrum styles should be removed");
  assertIncludes(playerCss, "--af-immersive-popover-text-primary", "Immersive popovers define local readable text");
  assertIncludes(playerCss, ".af-immersive-visualizer-poster .af-immersive-queue-panel", "Poster queue panel has readable surface");
  assertIncludes(playerCss, "color: var(--af-immersive-popover-text-primary)", "Queue panel text uses popover text color");

  const playbackSync = read("src/services/lyrics/playbackSync.ts");
  assertIncludes(playbackSync, "MAX_LYRIC_LINE_PROGRESS_SECONDS", "Lyric progress should not stretch across long instrumental gaps");
  assertIncludes(playbackSync, "getLineTimedEnd", "Lyric progress should use timed word endings when available");
}

function testLyricPlaybackSyncBehavior() {
  const {
    calculateLyricLineProgress,
    findCurrentLyricLine,
  } = loadTsModule("src/services/lyrics/playbackSync.ts");
  const longInstrumentalGapLines = [
    { time: 10, text: "想你" },
    { time: 24, text: "下一句歌词" },
  ];

  assert(
    findCurrentLyricLine(longInstrumentalGapLines, 12) === 0,
    "Lyric line selection should keep the current line active until the next timestamp",
  );
  assert(
    calculateLyricLineProgress(longInstrumentalGapLines, 0, 12) >= 0.95,
    "Short untimed lyric line progress should finish before a long instrumental gap",
  );

  const timedWordLines = [
    {
      time: 10,
      text: "逐字歌词",
      words: [
        { text: "逐", start: 10, dur: 0.3 },
        { text: "字", start: 10.3, dur: 0.3 },
        { text: "歌词", start: 10.6, dur: 0.4 },
      ],
    },
    { time: 18, text: "下一句" },
  ];
  assert(
    calculateLyricLineProgress(timedWordLines, 0, 11) === 1,
    "Timed word endings should remain the preferred lyric progress end",
  );
}

function testMainWindowCustomChrome() {
  const tauriConfig = read("src-tauri/tauri.conf.json");
  const defaultCapability = read("src-tauri/capabilities/default.json");
  const layout = read("src/components/Layout/Layout.tsx");
  const titleBar = read("src/components/Layout/AppTitleBar.tsx");
  const indexCss = read("src/index.css");
  const playerCss = read("src/styles/player.css");

  assertIncludes(tauriConfig, '"decorations": false', "Main Tauri window");
  assertNotIncludes(tauriConfig, '"decorations": true', "Main Tauri window");
  assertIncludes(defaultCapability, '"core:window:allow-minimize"', "Main Tauri window permissions");
  assertIncludes(defaultCapability, '"core:window:allow-toggle-maximize"', "Main Tauri window permissions");
  assertIncludes(layout, "AppTitleBar", "Main app custom titlebar");
  assertIncludes(titleBar, "startDragging", "Custom titlebar dragging");
  assertIncludes(titleBar, "data-tauri-drag-region", "Custom titlebar drag region");
  assertIncludes(titleBar, ".minimize()", "Custom titlebar minimize");
  assertIncludes(titleBar, ".toggleMaximize()", "Custom titlebar maximize");
  assertIncludes(titleBar, ".close()", "Custom titlebar close");
  assertIncludes(titleBar, "aria-label=\"最小化窗口\"", "Custom titlebar accessibility");
  assertIncludes(titleBar, "aria-label=\"最大化或还原窗口\"", "Custom titlebar accessibility");
  assertIncludes(titleBar, "aria-label=\"关闭窗口\"", "Custom titlebar accessibility");
  assertIncludes(indexCss, "--af-window-titlebar-height", "Custom titlebar sizing");
  assertIncludes(indexCss, ".af-window-titlebar", "Custom titlebar styles");
  assertIncludes(indexCss, ".af-window-drag-region", "Custom titlebar drag styles");
  assertIncludes(indexCss, ".af-window-control", "Custom titlebar control styles");
  assertIncludes(indexCss, ".af-window-control-close", "Custom titlebar close styles");
  assertIncludes(indexCss, ".af-app:has(.af-immersive-lyrics) .af-window-titlebar", "Custom titlebar blends into immersive lyrics");
  assertIncludes(indexCss, ".af-app:has(.af-immersive-lyrics) .af-window-app-mark", "Custom titlebar hides brand mark in immersive lyrics");
  assertIncludes(indexCss, "display: none", "Custom titlebar hides brand text in immersive lyrics");
  assertIncludes(indexCss, "background: transparent", "Custom titlebar blends into immersive lyrics");
  assertIncludes(playerCss, "inset: 0", "Immersive overlay reaches the window top");
  assertNotIncludes(playerCss, "inset: var(--af-window-titlebar-height) 0 0", "Immersive overlay should not leave a titlebar gap");
  assertIncludes(indexCss, ".af-app:has(.af-immersive-native-fullscreen) .af-window-titlebar", "Custom titlebar hides in native fullscreen");
}

function testPersistentPlaybackAndLyricCache() {
  const bridge = read("packages/tauri-bridge/src/index.ts");
  const library = read("src-tauri/src/library.rs");
  const cacheService = read("src/services/persistentCache.ts");
  const resolver = read("src/services/playback/playbackResolver.ts");
  const playerStore = read("src/stores/playerStore.ts");
  const lyricsService = read("src/services/lyricsService.ts");

  assertIncludes(bridge, '| "cache"', "Tauri bridge library namespaces");
  assertIncludes(library, '"cache"', "Rust library namespace whitelist");
  assertIncludes(cacheService, "PLAYBACK_URL_TTL_MS", "Persistent cache playback URL TTL");
  assertIncludes(cacheService, "LYRIC_FOUND_TTL_MS", "Persistent cache lyric TTL");
  assertIncludes(cacheService, "LYRIC_EMPTY_TTL_MS", "Persistent cache no-lyric TTL");
  assertIncludes(cacheService, "getCachedPlaybackUrl", "Persistent cache playback lookup");
  assertIncludes(cacheService, "saveCachedPlaybackUrl", "Persistent cache playback save");
  assertIncludes(cacheService, "invalidateCachedPlaybackUrl", "Persistent cache playback invalidation");
  assertIncludes(cacheService, "getCachedLyrics", "Persistent cache lyric lookup");
  assertIncludes(cacheService, "saveCachedLyrics", "Persistent cache lyric save");
  assertIncludes(cacheService, "isCacheableEmptyLyricResult", "Persistent cache no-lyric policy");
  assertIncludes(cacheService, "normalizeQualityKey", "Persistent cache quality key normalization");
  assertIncludes(resolver, "getCachedPlaybackUrl", "Playback resolver reads persistent cache");
  assertIncludes(resolver, "saveCachedPlaybackUrl", "Playback resolver saves persistent cache");
  assertIncludes(resolver, "bypassCache", "Playback resolver can bypass stale persistent cache");
  assertIncludes(playerStore, "invalidateCachedPlaybackUrl", "Player store invalidates stale persistent cache");
  assertIncludes(playerStore, "fromCache", "Player store detects persistent cache playback failures");
  assertIncludes(lyricsService, "getCachedLyrics", "Lyrics service reads persistent cache");
  assertIncludes(lyricsService, "saveCachedLyrics", "Lyrics service saves persistent cache");
  assertIncludes(lyricsService, "lyricsCache.set(cacheKey, result)", "Lyrics service caches empty lyric result in memory");
}

function testSettingsInformationArchitecture() {
  const settingsView = read("src/views/SettingsView.tsx");
  const settingsCss = read("src/styles/settings.css");
  const immersiveOverlay = read("src/components/ImmersiveLyricsOverlay.tsx");
  const playerCss = read("src/styles/player.css");
  const bridge = read("packages/tauri-bridge/src/index.ts");
  const rustModels = read("src-tauri/src/models.rs");
  const miscSectionStart = settingsView.indexOf("function MiscSection()");
  const syncSectionStart = settingsView.indexOf("function SyncSection()");
  assert(miscSectionStart >= 0, "Settings view should include MiscSection");
  assert(syncSectionStart >= 0, "Settings view should include SyncSection");
  const miscSection = settingsView.slice(miscSectionStart, syncSectionStart);
  const syncSection = settingsView.slice(syncSectionStart);

  assertIncludes(settingsView, "type SettingsSectionId", "Settings view active section type");
  assertIncludes(settingsView, "const [activeSection, setActiveSection]", "Settings view category state");
  assertIncludes(settingsView, "getActiveSettingsSection", "Settings view renders only active section");
  assertIncludes(settingsView, "aria-current={activeSection === id ? \"page\" : undefined}", "Settings nav marks active category");
  assertNotIncludes(settingsView, "href={`#${id}`}", "Settings nav should switch panels instead of long-page anchors");

  assertIncludes(settingsView, "type LyricSettingsTab", "Desktop lyric settings tab type");
  assertIncludes(settingsView, "const [activeLyricTab, setActiveLyricTab]", "Desktop lyric settings tab state");
  assertIncludes(settingsView, "af-lyric-settings-tabs", "Desktop lyric settings tabs");
  assertIncludes(settingsView, "renderLyricSettingsTab", "Desktop lyric settings renders one tab at a time");

  assertIncludes(settingsView, "<details className=\"af-custom-source-details\">", "Custom source long details should be collapsed");
  assertIncludes(settingsCss, ".af-settings-nav-link.af-active", "Settings nav active styles");
  assertIncludes(settingsCss, ".af-settings-panel", "Settings panel surface");
  assertIncludes(settingsCss, ".af-lyric-settings-tabs", "Desktop lyric tab styles");
  assertIncludes(settingsCss, ".af-custom-source-details", "Custom source collapsed detail styles");

  assertNotIncludes(settingsView, "手动选择应用强调色。", "Appearance accent color helper copy");
  assertIncludes(settingsView, "IMMERSIVE_LYRIC_FONT_OPTIONS", "Appearance immersive lyric font choices");
  assertIncludes(settingsView, "immersiveLyricFontSize", "Appearance immersive lyric font size");
  assertIncludes(settingsView, "immersiveLyricFontFamily", "Appearance immersive lyric font family");
  assertNotIncludes(settingsView, "immersiveLyricColor", "Poster lyric color should stay fixed");
  assertIncludes(immersiveOverlay, "--af-immersive-lyric-font-family", "Immersive lyric font family css variable");
  assertIncludes(immersiveOverlay, "--af-immersive-lyric-font-size", "Immersive lyric font size css variable");
  assertIncludes(playerCss, "font-family: var(--af-immersive-lyric-font-family", "Poster lyrics use configurable font family");
  assertIncludes(playerCss, "font-size: var(--af-immersive-lyric-font-size", "Poster lyrics use configurable font size");
  assertIncludes(bridge, "immersiveLyricFontSize", "Tauri settings expose immersive lyric font size");
  assertIncludes(bridge, "immersiveLyricFontFamily", "Tauri settings expose immersive lyric font family");
  assertIncludes(rustModels, "immersive_lyric_font_size", "Rust settings persist immersive lyric font size");
  assertIncludes(rustModels, "immersive_lyric_font_family", "Rust settings persist immersive lyric font family");
  assertIncludes(miscSection, "软件更新", "Software update should live in Misc settings");
  assertIncludes(miscSection, "handleCheckUpdate", "Misc settings should own update check action");
  assertNotIncludes(syncSection, "<label className=\"af-settings-label\">软件更新</label>", "Sync settings");
}

function testCustomSourceUpdateDialogCentered() {
  const modal = read("src/components/CustomSourceUpdateModal.tsx");
  const layoutCss = read("src/styles/layout.css");

  assertIncludes(modal, "af-custom-source-update-overlay", "Custom source update modal overlay");
  assertIncludes(layoutCss, ".af-custom-source-update-overlay", "Custom source update modal overlay styles");
  assertCssRuleIncludes(layoutCss, ".af-custom-source-update-overlay", "display: grid", "Custom source update modal should use centered grid overlay");
  assertCssRuleIncludes(layoutCss, ".af-custom-source-update-overlay", "place-items: center", "Custom source update modal should be centered");
  assertCssRuleNotIncludes(layoutCss, ".af-custom-source-update-overlay", "flex-start", "Custom source update modal should not align to the top");
}

function testDailyRecommendCoverUsesFirstSong() {
  const dailyView = read("src/views/DailyRecommendView.tsx");

  assertIncludes(dailyView, "const dailyCoverUrl = daily[0]?.img || daily[0]?.picUrl || \"\"", "Daily recommend header cover");
  assertIncludes(dailyView, "dailyCoverUrl ? (", "Daily recommend header cover");
  assertIncludes(dailyView, "<img src={dailyCoverUrl}", "Daily recommend header should use first song cover");
  assertIncludes(dailyView, "alt={daily[0]?.name || \"每日推荐封面\"}", "Daily recommend header cover accessibility");
}

function testQuietSidebarSelectionAndImmersiveFonts() {
  const indexCss = read("src/index.css");
  const settingsView = read("src/views/SettingsView.tsx");

  assertCssRuleIncludes(indexCss, ".af-sidebar-link", "position: relative", "Sidebar links should anchor the active marker");
  assertCssRuleIncludes(indexCss, ".af-sidebar-link", "overflow: hidden", "Sidebar links should clip the active marker");
  assertCssRuleIncludes(indexCss, ".af-sidebar-link.active", "color: var(--af-accent-primary)", "Sidebar active item should follow accent text");
  assertCssRuleIncludes(indexCss, ".af-sidebar-link.active", "background: rgba(var(--af-accent-primary-rgb), 0.10)", "Sidebar active item should use a quiet accent wash");
  assertCssRuleIncludes(indexCss, ".af-sidebar-link.active", "box-shadow: none", "Sidebar active item should not look raised");
  assertCssRuleNotIncludes(indexCss, ".af-sidebar-link.active", "var(--af-accent-gradient)", "Sidebar active item should not use a loud gradient");
  assertCssRuleNotIncludes(indexCss, ".af-sidebar-link.active", "0 4px 12px", "Sidebar active item should not use the old large glow");
  assertCssRuleIncludes(indexCss, ".af-sidebar-link.active::before", "width: 3px", "Sidebar active item should have a short left marker");
  assertCssRuleIncludes(indexCss, ".af-sidebar-link.active::before", "height: 18px", "Sidebar active item should have a short left marker");
  assertCssRuleIncludes(indexCss, ".af-sidebar-link.active::before", "background: var(--af-accent-primary)", "Sidebar active marker should follow the accent color");
  assertNotIncludes(indexCss, "--af-sidebar-active-color", "Sidebar active color should not be hard-coded");
  assertNotIncludes(indexCss, "--af-sidebar-active-bg", "Sidebar active background should not be hard-coded");

  assertIncludes(settingsView, "霞鹜文楷", "Immersive lyric font choices");
  assertIncludes(settingsView, "思源宋体", "Immersive lyric font choices");
  assertIncludes(settingsView, "HarmonyOS Sans", "Immersive lyric font choices");
  assertIncludes(settingsView, "獅尾四季春加糖SC", "Immersive lyric optional font choice");
  assertNotIncludes(settingsView, "日文手写感", "Immersive lyric font choices");
  assertNotIncludes(settingsView, "清晰黑体", "Immersive lyric font choices");
  assertNotIncludes(settingsView, "柔和圆体", "Immersive lyric font choices");
}

function testQuietAccentSystem() {
  const themeCss = read("src/styles/theme.css");
  const themeStore = read("src/stores/themeStore.ts");
  const settingsView = read("src/views/SettingsView.tsx");
  const settingsCss = read("src/styles/settings.css");
  const buttonsCss = read("src/styles/buttons.css");
  const playlistsCss = read("src/styles/playlists.css");
  const accentDrivenUi = [
    read("src/index.css"),
    buttonsCss,
    playlistsCss,
    read("src/styles/player.css"),
    read("src/styles/home.css"),
    read("src/styles/local-music.css"),
    read("src/views/ArtistDetailView.tsx"),
    read("src/views/LyricWindowView.tsx"),
  ].join("\n");

  assertIncludes(themeCss, "--af-accent-primary: #3bd877", "Default accent should be quiet green");
  assertIncludes(themeCss, "--af-accent-primary-rgb: 59, 216, 119", "Default accent rgb should be quiet green");
  assertNotIncludes(themeCss, "#1db954", "Theme defaults should not keep the old green accent");
  assertNotIncludes(themeCss, "29, 185, 84", "Theme defaults should not keep the old green accent rgb");
  assertIncludes(themeStore, "const DEFAULT_ACCENT_COLOR = \"#3bd877\"", "Theme store default accent");
  assertIncludes(themeStore, "const LEGACY_DEFAULT_ACCENT_COLOR = \"#1db954\"", "Theme store should migrate old default green");
  assertIncludes(themeStore, "const LEGACY_RED_ACCENT_COLOR = \"#d83b40\"", "Theme store should migrate old default red");
  assertIncludes(themeStore, "migrateAccentColor", "Theme store should migrate old default green");
  assertIncludes(settingsView, "handleAccentColorTextChange", "Appearance accent color should support hex text input");
  assertIncludes(settingsView, "af-appearance-color-hex", "Appearance accent color should render a hex text input");
  assertIncludes(settingsView, "aria-invalid={!isAccentColorInputValid}", "Appearance accent color should expose invalid hex state");
  assertIncludes(settingsView, "type=\"text\"", "Appearance accent color should use editable text input");
  assertIncludes(settingsCss, ".af-appearance-color-hex", "Appearance accent color hex input styles");
  assertIncludes(settingsCss, ".af-appearance-color-hex.af-invalid", "Appearance accent color invalid state styles");

  assertIncludes(buttonsCss, ".af-create-playlist-btn:not(.af-btn-secondary),\n.af-library-button-primary", "Primary button selector set");
  assertIncludes(buttonsCss, "background: rgba(var(--af-accent-primary-rgb), 0.12)", "Primary buttons should use quiet accent wash");
  assertIncludes(buttonsCss, "color: var(--af-accent-primary)", "Primary buttons should use accent text");
  assertIncludes(buttonsCss, "box-shadow: none", "Primary buttons should not use loud shadows");
  assertNotIncludes(buttonsCss, "background: linear-gradient(180deg, rgba(var(--af-accent-primary-rgb)", "Primary buttons should not use filled gradients");
  assertIncludes(buttonsCss, ".af-play-button", "Play button selector set");
  assertIncludes(buttonsCss, ".af-grid-play-button", "Play button selector set");
  assertIncludes(buttonsCss, ".af-play-all-btn", "Play button selector set");
  assertIncludes(buttonsCss, ".af-playlist-play-button", "Play button selector set");
  assertIncludes(buttonsCss, ".af-icon-btn-active", "Active icon button selector set");
  assertIncludes(buttonsCss, ".af-action-btn.af-liked", "Active icon button selector set");
  assertIncludes(buttonsCss, ".af-like-button.af-active", "Active icon button selector set");
  assertIncludes(buttonsCss, ".af-control-btn.af-active", "Active icon button selector set");
  assertIncludes(buttonsCss, ".af-view-mode-toggle button.af-active", "Active icon button selector set");

  assertCssRuleIncludes(playlistsCss, ".af-liked-card", "background: rgba(var(--af-accent-primary-rgb), 0.12)", "Liked music card should use quiet accent wash");
  assertCssRuleIncludes(playlistsCss, ".af-liked-card", "color: var(--af-accent-primary)", "Liked music card should use accent text");
  assertCssRuleNotIncludes(playlistsCss, ".af-liked-card", "29, 185, 84", "Liked music card should not keep hard-coded green");
  assertCssRuleNotIncludes(playlistsCss, ".af-liked-card", "20, 145, 76", "Liked music card should not keep hard-coded green");
  assertCssRuleNotIncludes(playlistsCss, ".af-liked-card", "#d83b40", "Liked music card should not hard-code the default red");
  assertNotIncludes(playlistsCss, "rgba(29, 185, 84", "Playlist styles should not keep hard-coded green");
  assertNotIncludes(playlistsCss, "rgba(36, 205, 99", "Playlist styles should not keep hard-coded green");
  assertNotIncludes(accentDrivenUi, "#d83b40", "Accent-driven UI components should not hard-code the default red");
  assertNotIncludes(accentDrivenUi, "rgba(29, 185, 84", "Accent-driven UI components should not hard-code old green");
  assertNotIncludes(accentDrivenUi, "rgba(34, 197, 94", "Accent-driven UI components should not hard-code old green");
  assertNotIncludes(accentDrivenUi, "rgba(36, 205, 99", "Accent-driven UI components should not hard-code old green");
  assertNotIncludes(accentDrivenUi, "rgba(20, 145, 76", "Accent-driven UI components should not hard-code old green");
}

function testNeteaseScrobbleSync() {
  const scrobbleService = read("src/services/scrobbleService.ts");
  const settingsView = read("src/views/SettingsView.tsx");
  const bridge = read("packages/tauri-bridge/src/index.ts");
  const rustModels = read("src-tauri/src/models.rs");

  assertIncludes(bridge, "neteaseScrobbleSync", "Tauri settings expose Netease scrobble sync switch");
  assertIncludes(rustModels, "netease_scrobble_sync", "Rust settings persist Netease scrobble sync switch");
  assertIncludes(rustModels, "#[serde(default = \"default_true\")]\n    pub netease_scrobble_sync", "Existing settings should keep Netease scrobble sync enabled by default");
  assertIncludes(settingsView, "neteaseScrobbleSync", "Playback settings should render Netease scrobble sync switch");
  assertIncludes(settingsView, "handleNeteaseScrobbleSyncChange", "Playback settings should persist Netease scrobble sync switch");

  assertIncludes(scrobbleService, "SCROBBLE_RETRY_QUEUE_KEY", "Netease scrobble failures should be persisted for retry");
  assertIncludes(scrobbleService, "enqueueScrobbleRetry", "Netease scrobble failures should enter retry queue");
  assertIncludes(scrobbleService, "flushScrobbleRetryQueue", "Netease scrobble retry queue should be flushed");
  assertIncludes(scrobbleService, "loadSettings", "Netease scrobble should respect settings");
  assertIncludes(scrobbleService, "settings.neteaseScrobbleSync !== false", "Netease scrobble should be enabled unless explicitly disabled");
  assertIncludes(scrobbleService, "music.source === \"wy\"", "Netease scrobble should only sync Netease tracks");
  assertIncludes(scrobbleService, "MAX_RETRY_QUEUE_SIZE", "Netease scrobble retry queue should be bounded");
  assertIncludes(scrobbleService, "RETRY_FLUSH_INTERVAL_MS", "Netease scrobble retry should run periodically");
  assertNotIncludes(scrobbleService, "console.warn(\"[scrobble] 上报失败\"", "Netease scrobble should not only log failures");
}

function testHistoryQuickEntryAndUpdateModalCentering() {
  const app = read("src/App.tsx");
  const playlistsView = read("src/views/PlaylistsView.tsx");
  const historyView = read("src/views/HistoryView.tsx");
  const playlistDetailView = read("src/views/PlaylistDetailView.tsx");
  const layoutCss = read("src/styles/layout.css");

  assertIncludes(app, "HistoryView", "App should register playback history view");
  assertIncludes(app, 'path="history"', "App should route to playback history");
  assertIncludes(playlistsView, "History", "Playlist quick entry should use history icon");
  assertIncludes(playlistsView, "播放历史", "Playlist quick entry should include playback history");
  assertIncludes(playlistsView, "useHistoryStore", "Playlist quick entry should show playback history count");
  assertIncludes(playlistsView, "navigate('/history')", "Playlist quick entry should open playback history");
  assertIncludes(playlistsView, "firstFavoriteCover", "Liked music quick entry should use first song cover");
  assertIncludes(playlistsView, "firstHistoryCover", "History quick entry should use first song cover");
  assertIncludes(playlistsView, "af-quick-cover", "Quick entries should use the same cover layout");
  assertNotIncludes(playlistsView, "af-liked-card", "Quick entries should not use mismatched color treatments");
  assertIncludes(historyView, "useHistoryStore", "History view should read local playback history");
  assertIncludes(historyView, "playQueue(history, index)", "History view should play from selected history item");
  assertIncludes(historyView, "播放历史", "History view should be labeled clearly");
  assertIncludes(historyView, "historyCover", "History view should use first history song cover");
  assertIncludes(historyView, "af-playlist-detail-header", "History view should match playlist detail header layout");
  assertIncludes(playlistDetailView, "favorites[0]?.img", "Favorites playlist cover should use first favorite song cover");

  assertCssRuleIncludes(layoutCss, ".af-custom-source-update-overlay", "position: fixed", "Custom source update modal overlay should cover the window");
  assertCssRuleIncludes(layoutCss, ".af-custom-source-update-overlay", "min-height: 100dvh", "Custom source update modal overlay should use viewport height");
  assertCssRuleIncludes(layoutCss, ".af-custom-source-update-overlay", "place-items: center", "Custom source update modal should be visually centered");
  assertCssRuleIncludes(layoutCss, ".af-custom-source-update-overlay", "align-items: center", "Custom source update modal should override top alignment");
  assertCssRuleIncludes(layoutCss, ".af-custom-source-update-overlay", "justify-content: center", "Custom source update modal should override flex centering");
  assertCssRuleNotIncludes(layoutCss, ".af-custom-source-update-overlay", "align-items: flex-start", "Custom source update modal should not align to the top");
}

function testDataManagementClearsOnlyHistoryAndSongCache() {
  const settingsView = read("src/views/SettingsView.tsx");
  const bridge = read("packages/tauri-bridge/src/index.ts");
  const rustCommands = read("src-tauri/src/commands.rs");
  const rustMain = read("src-tauri/src/main.rs");
  const persistentCache = read("src/services/persistentCache.ts");
  const prefetchService = read("src/services/playback/prefetchService.ts");

  assertIncludes(settingsView, "getSongCacheStats", "Data management should show song cache size");
  assertIncludes(settingsView, "clearSongCache", "Data management should clear song cache files");
  assertIncludes(settingsView, 'libraryReset("recent")', "Data management should clear playback history persistence");
  assertIncludes(settingsView, "useHistoryStore.getState().replaceAll([])", "Data management should clear playback history state");
  assertIncludes(settingsView, "clearPersistentCache", "Data management should clear persistent song cache");
  assertIncludes(settingsView, "clearPlaybackPrefetchCache", "Data management should clear in-memory playback prefetch cache");
  assertIncludes(settingsView, "歌曲缓存", "Data management should label song cache size");
  assertIncludes(settingsView, "播放历史与歌曲缓存", "Data management should describe the limited clear scope");
  assertIncludes(settingsView, "仅清空播放历史与歌曲缓存，其他数据保留。", "Data management should use concise copy");
  assertNotIncludes(settingsView, "只清空播放历史、播放链接/歌词缓存和已缓存歌曲文件；", "Data management should not use long explanatory copy");
  assertNotIncludes(settingsView, "resetUserDataWithActions", "Data management should not reset all user data");
  assertNotIncludes(settingsView, "libraryResetAll", "Data management should not delete all library namespaces");
  assertNotIncludes(settingsView, "重置全部用户数据", "Data management should not present a destructive all-data reset");
  assertNotIncludes(settingsView, "清空喜欢的音乐", "Data management should not claim favorites are cleared");

  assertIncludes(bridge, "SongCacheStats", "Tauri bridge should expose song cache stats type");
  assertIncludes(bridge, "getSongCacheStats", "Tauri bridge should expose cache stats command");
  assertIncludes(bridge, "clearSongCache", "Tauri bridge should expose cache clear command");
  assertIncludes(rustCommands, "pub struct SongCacheStats", "Rust commands should return cache stats");
  assertIncludes(rustCommands, "pub fn get_song_cache_stats", "Rust commands should expose cache stats");
  assertIncludes(rustCommands, "pub fn clear_song_cache", "Rust commands should expose cache clear");
  assertIncludes(rustMain, "commands::get_song_cache_stats", "Tauri main should register cache stats command");
  assertIncludes(rustMain, "commands::clear_song_cache", "Tauri main should register cache clear command");
  assertIncludes(persistentCache, "resetPersistentCacheMemory", "Persistent cache should expose memory reset");
  assertIncludes(persistentCache, "clearPersistentCache", "Persistent cache should expose disk and memory clear");
  assertIncludes(prefetchService, "clearPlaybackPrefetchCache", "Playback prefetch cache should remain clearable");
}

function testPlaylistDetailLocatesCurrentSong() {
  const playlistDetailView = read("src/views/PlaylistDetailView.tsx");
  const playlistsCss = read("src/styles/playlists.css");

  assertIncludes(playlistDetailView, "LocateFixed", "Playlist detail should provide a locate-current-song action");
  assertIncludes(playlistDetailView, "currentTrack", "Playlist detail should read the currently playing track");
  assertIncludes(playlistDetailView, "currentSongIndex", "Playlist detail should compute current song position in the playlist");
  assertIncludes(playlistDetailView, "scrollToIndex={locateScrollIndex}", "Playlist detail should pass the target index to the virtual list");
  assertIncludes(playlistDetailView, "handleLocateCurrentSong", "Playlist detail should expose a locate handler");
  assertIncludes(playlistDetailView, "af-current-playing", "Playlist detail should mark the located playing row");
  assertIncludes(playlistDetailView, "当前播放", "Playlist detail should label the current song location action");
  assertCssRuleIncludes(playlistsCss, ".af-song-list-row.af-current-playing", "background", "Current playing song row should be visually highlighted");
}

function testBilibiliSubscribedCollections() {
  const coreTypes = read("packages/core/src/sources/types.ts");
  const sourceService = read("src/services/sources/sourceService.ts");
  const playbackTypes = read("src/services/playback/types.ts");
  const playbackResolver = read("src/services/playback/playbackResolver.ts");
  const biliProvider = read("src/services/sources/biliProvider.ts");
  const biliAccountService = read("src/services/biliAccountService.ts");
  const biliAccountStore = read("src/stores/biliAccountStore.ts");
  const playlistsView = read("src/views/PlaylistsView.tsx");
  const playlistsCss = read("src/styles/playlists.css");
  const indexCss = read("src/index.css");
  const playlistDetailView = read("src/views/PlaylistDetailView.tsx");
  const prefetchService = read("src/services/playback/prefetchService.ts");
  const settingsView = read("src/views/SettingsView.tsx");
  const bridge = read("packages/tauri-bridge/src/index.ts");
  const rustModels = read("src-tauri/src/models.rs");
  const rustCommands = read("src-tauri/src/commands.rs");
  const rustMain = read("src-tauri/src/main.rs");

  assertIncludes(coreTypes, '"bili"', "Core source tags should include Bilibili");
  assertIncludes(sourceService, "biliProvider", "Source registry should register Bilibili provider");
  assertIncludes(playbackTypes, "'builtinProvider'", "Playback backends should include generic builtin provider resolution");
  assertIncludes(playbackResolver, "builtinProviderBackend", "Playback resolver should use generic builtin provider backend");
  assertIncludes(biliProvider, "resolveLegacyPlayUrl", "Bilibili provider should try the stable legacy playurl endpoint first");
  assertIncludes(biliProvider, "x/player/playurl", "Bilibili provider should resolve DASH audio through the legacy playurl endpoint");
  assertIncludes(biliProvider, "encWbi", "Bilibili provider should WBI-sign playurl requests");
  assertIncludes(biliProvider, "resolveWbiPlayUrl", "Bilibili provider should keep WBI playurl as fallback");
  assertIncludes(biliProvider, "x/player/wbi/playurl", "Bilibili provider should keep WBI-signed DASH audio fallback");
  assertIncludes(biliProvider, "B站播放地址解析失败", "Bilibili provider should report all playurl strategy failures together");
  assertIncludes(biliProvider, "dash?.audio", "Bilibili provider should select DASH audio streams");
  assertIncludes(biliProvider, "biliCacheAudio", "Bilibili provider should cache DASH audio through Rust before playback");
  assertIncludes(biliProvider, "convertFileSrc", "Bilibili provider should return a local asset URL for cached audio");
  assertIncludes(biliProvider, "暂无歌词", "Bilibili provider should explicitly report no lyrics");
  assertIncludes(biliProvider, "biliGetJson", "Bilibili provider should request APIs through the Rust backend proxy");
  assertIncludes(biliAccountService, "x/web-interface/nav", "Bilibili account service should validate Cookie through nav API");
  assertIncludes(biliAccountService, "biliGetJson", "Bilibili account service should request APIs through the Rust backend proxy");
  assertIncludes(biliAccountService, "x/v3/fav/folder/collected/list", "Bilibili account service should load subscribed collections");
  assertIncludes(biliAccountService, "platform\", \"web\"", "Bilibili collected list should request platform=web");
  assertIncludes(biliAccountService, "web_location", "Bilibili collected list should match web request context");
  assertIncludes(biliAccountService, "favlist?ftype=collect", "Bilibili collected list should use the space favlist referer");
  assertIncludes(biliAccountService, "B站请求失败: ${path}", "Bilibili request errors should include the failing endpoint path");
  assertIncludes(biliAccountService, "x/v3/fav/resource/list", "Bilibili account service should load favorite-folder contents");
  assertIncludes(biliAccountService, "seasons_archives_list", "Bilibili account service should expand subscribed video collections");
  assertIncludes(biliAccountService, "mapBiliArchiveToMusic", "Bilibili account service should map archives into MusicInfo");
  assertIncludes(biliAccountStore, "useBiliAccountStore", "Bilibili account store should exist");
  assertIncludes(biliAccountStore, "hiddenCollectionIds", "Bilibili account store should persist hidden collection preferences");
  assertIncludes(biliAccountStore, "newCollectionIds", "Bilibili account store should track newly discovered collections");
  assertIncludes(biliAccountStore, "autoShowNewCollections", "Bilibili account store should let users choose whether new collections appear automatically");
  assertIncludes(biliAccountStore, "getVisibleCollections", "Bilibili account store should expose visible collections for the playlist page");
  assertIncludes(biliAccountStore, "setCollectionVisible", "Bilibili account store should let users hide or show individual collections");
  assertIncludes(biliAccountStore, "getCollectionSongs", "Bilibili account store should expose collection songs");
  assertIncludes(playlistsView, "useBiliAccountStore", "Playlist view should show Bilibili subscribed collections");
  assertIncludes(playlistsView, "B站收藏合集", "Playlist view should label Bilibili collections");
  assertIncludes(playlistsView, "visibleBiliPlaylists", "Playlist view should render only enabled Bilibili collection cards");
  assertIncludes(playlistsView, "showBiliManager", "Playlist view should provide a Bilibili collection manager dialog");
  assertIncludes(playlistsView, "隐藏此合集", "Playlist view should let users hide unwanted Bilibili collections from the card menu");
  assertIncludes(playlistsView, "新发现", "Playlist view should label newly discovered Bilibili collections in the manager");
  assertIncludes(playlistsView, "新合集自动显示", "Playlist view should expose the automatic visibility policy for future collections");
  assertIncludes(playlistsView, "af-bili-manager-dialog", "Playlist view should use a dedicated manager dialog class");
  assertIncludes(playlistsView, "af-page-scroll-locked", "Playlist modals should lock the app page scroll while open");
  assertIncludes(indexCss, ".af-page-scroll-locked .af-content-scroll", "Global layout should lock the scroll container behind modals");
  assertCssRuleIncludes(indexCss, ".af-page-scroll-locked .af-content-scroll", "overflow-y: hidden", "Modal scroll lock should disable background page scrolling");
  assertIncludes(playlistsCss, ".af-bili-manager-dialog", "Playlist styles should include the Bilibili manager dialog");
  assertIncludes(playlistsCss, ".af-bili-collection-row", "Playlist styles should include Bilibili collection rows");
  assertIncludes(playlistsCss, ".af-bili-visibility-switch", "Playlist styles should include accessible visibility toggles");
  assertIncludes(playlistDetailView, '"bili"', "Playlist detail should accept Bilibili remote source");
  assertIncludes(playlistDetailView, "biliGetSongs", "Playlist detail should load Bilibili collection songs");
  assertIncludes(prefetchService, "music.source !== 'bili'", "Bilibili prefetch should avoid full background audio downloads");
  assertIncludes(settingsView, "biliCookie", "Settings should expose Bilibili Cookie login");
  assertIncludes(settingsView, "保存并验证 B站 Cookie", "Settings should validate Bilibili Cookie");
  assertIncludes(bridge, "biliCookie", "Tauri settings expose Bilibili Cookie");
  assertIncludes(bridge, "biliGetJson", "Tauri bridge should expose Bilibili backend HTTP proxy");
  assertIncludes(bridge, "biliCacheAudio", "Tauri bridge should expose Bilibili audio cache command");
  assertIncludes(rustModels, "bili_cookie", "Rust settings persist Bilibili Cookie");
  assertIncludes(rustCommands, "pub async fn bili_get_json", "Rust commands should provide Bilibili backend HTTP proxy");
  assertIncludes(rustCommands, "pub async fn bili_cache_audio", "Rust commands should cache Bilibili media with proper headers");
  assertIncludes(rustCommands, "BILI_AUDIO_CACHE_DIR", "Rust commands should keep Bilibili playback cache isolated");
  assertIncludes(rustCommands, "api.bilibili.com", "Bilibili backend proxy should restrict requests to the Bilibili API host");
  assertIncludes(rustCommands, "ORIGIN", "Bilibili backend proxy should include browser-like Origin headers");
  assertIncludes(rustMain, "commands::bili_get_json", "Tauri invoke handler should register the Bilibili backend HTTP proxy");
  assertIncludes(rustMain, "commands::bili_cache_audio", "Tauri invoke handler should register the Bilibili audio cache command");
}

function testBilibiliCoverReferrerPolicy() {
  const imageReferrerPolicy = read("src/utils/imageReferrerPolicy.ts");
  const biliAccountService = read("src/services/biliAccountService.ts");
  const playlistsView = read("src/views/PlaylistsView.tsx");
  const playlistDetailView = read("src/views/PlaylistDetailView.tsx");
  const playerBar = read("src/components/PlayerBar.tsx");
  const immersiveLyricsOverlay = read("src/components/ImmersiveLyricsOverlay.tsx");

  assertIncludes(imageReferrerPolicy, "biliimg.com", "Bilibili image helper should detect biliimg cover hosts");
  assertIncludes(imageReferrerPolicy, "hdslb.com", "Bilibili image helper should detect hdslb cover hosts");
  assertIncludes(imageReferrerPolicy, "normalizeImageUrl", "Bilibili image helper should normalize cover URLs");
  assertIncludes(imageReferrerPolicy, "url.protocol = \"https:\"", "Bilibili image helper should upgrade Bilibili http covers to https");
  assertIncludes(imageReferrerPolicy, "no-referrer", "Bilibili image helper should remove local referer from cover requests");
  assertIncludes(biliAccountService, "normalizeImageUrl", "Bilibili account service should normalize Bilibili cover URLs at the data boundary");
  assertIncludes(playlistsView, "getImageReferrerPolicy", "Playlist cards should use image referrer policy helper");
  assertIncludes(playlistsView, "normalizeImageUrl", "Playlist cards should render normalized Bilibili image URLs");
  assertIncludes(playlistDetailView, "getImageReferrerPolicy", "Playlist detail covers should use image referrer policy helper");
  assertIncludes(playerBar, "getImageReferrerPolicy", "Player cover should use image referrer policy helper");
  assertIncludes(immersiveLyricsOverlay, "getImageReferrerPolicy", "Immersive lyrics cover should use image referrer policy helper");
}

const tests = [
  ["search layout contract", testSearchLayoutContract],
  ["immersive lyric visualizer modes", testImmersiveLyricVisualizerModes],
  ["lyric playback sync behavior", testLyricPlaybackSyncBehavior],
  ["main window custom chrome", testMainWindowCustomChrome],
  ["persistent playback and lyric cache", testPersistentPlaybackAndLyricCache],
  ["settings information architecture", testSettingsInformationArchitecture],
  ["custom source update dialog centered", testCustomSourceUpdateDialogCentered],
  ["daily recommend cover uses first song", testDailyRecommendCoverUsesFirstSong],
  ["quiet sidebar selection and immersive fonts", testQuietSidebarSelectionAndImmersiveFonts],
  ["quiet accent system", testQuietAccentSystem],
  ["netease scrobble sync", testNeteaseScrobbleSync],
  ["history quick entry and update modal centering", testHistoryQuickEntryAndUpdateModalCentering],
  ["data management clears only history and song cache", testDataManagementClearsOnlyHistoryAndSongCache],
  ["playlist detail locates current song", testPlaylistDetailLocatesCurrentSong],
  ["bilibili subscribed collections", testBilibiliSubscribedCollections],
  ["bilibili cover referrer policy", testBilibiliCoverReferrerPolicy],
];

let passed = 0;
for (const [name, test] of tests) {
  try {
    test();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.exitCode) {
  process.exit();
}

console.log(`${passed}/${tests.length} regression tests passed`);
