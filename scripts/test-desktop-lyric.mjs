import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTsModule(relativePath, options = {}) {
  const sourcePath = resolve(__dirname, relativePath);
  assert.equal(existsSync(sourcePath), true, `${relativePath} should exist`);

  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  const moduleRequire = (id) => {
    if (options.requireStubs && Object.prototype.hasOwnProperty.call(options.requireStubs, id)) {
      return options.requireStubs[id];
    }
    return require(id);
  };
  vm.runInNewContext(transpiled.outputText, {
    exports: module.exports,
    module,
    require: moduleRequire,
    ...(options.context ?? {}),
  }, { filename: sourcePath });
  return module.exports;
}

const { buildDesktopLyricLines } = loadTsModule("../src/utils/desktopLyric.ts");
const { detectWindowRoleFromParts } = loadTsModule("../src/utils/windowRole.ts");
const { toggleDesktopLyricFromPlayer } = loadTsModule("../src/utils/desktopLyricToggle.ts", {
  context: {
    setTimeout,
    clearTimeout,
  },
  requireStubs: {
    "@lx/tauri-bridge": {
      unlockLyricWindowFromPlayer: async () => ({
        unlocked: false,
        open: false,
        locked: false,
      }),
      getLyricWindowState: async () => ({
        open: false,
        locked: false,
      }),
      toggleLyricWindowFromPlayer: async () => ({
        action: "opened",
        open: true,
        locked: false,
        message: "桌面歌词已打开",
      }),
    },
    "@/stores/lyricSettingsSync": {
      broadcastLyricSettings: () => {},
      readPersistedLyricLocked: () => false,
    },
  },
});

assert.equal(typeof buildDesktopLyricLines, "function", "buildDesktopLyricLines should be exported");
assert.equal(typeof detectWindowRoleFromParts, "function", "detectWindowRoleFromParts should be exported");
assert.equal(typeof toggleDesktopLyricFromPlayer, "function", "desktop lyric player toggle helper should be exported");

assert.deepEqual(
  JSON.parse(JSON.stringify(await toggleDesktopLyricFromPlayer(async () => ({
    action: "unlocked",
    open: true,
    locked: false,
    message: "桌面歌词已解锁",
  })))),
  { action: "unlocked", open: true, locked: false, message: "桌面歌词已解锁" },
  "player desktop lyric helper should return the backend lock-aware toggle result",
);

assert.deepEqual(
  JSON.parse(JSON.stringify(await toggleDesktopLyricFromPlayer(
    async () => {
      throw new Error("backend toggle should not be called after the unlock-first command succeeds");
    },
    {
      unlockFirst: async () => ({ unlocked: true, open: true, locked: false }),
      setLocked: async () => {
        throw new Error("setLocked fallback should not be called when unlock-first succeeds");
      },
      broadcastSettings: () => {},
    },
  ))),
  { action: "unlocked", open: true, locked: false, message: "桌面歌词已解锁" },
  "player desktop lyric helper should stop after the backend unlock-first command unlocks the lyric window",
);

assert.deepEqual(
  JSON.parse(JSON.stringify(await toggleDesktopLyricFromPlayer(
    async () => {
      throw new Error("backend should not be called when frontend already knows the lyric is locked");
    },
    {
      knownOpen: true,
      knownLocked: true,
      getState: async () => {
        throw new Error("state query unavailable");
      },
      setLocked: async () => {},
      broadcastSettings: () => {},
    },
  ))),
  { action: "unlocked", open: true, locked: false, message: "桌面歌词已解锁" },
  "player desktop lyric helper should unlock immediately when the player already knows the lyric window is locked",
);

assert.deepEqual(
  JSON.parse(JSON.stringify(await toggleDesktopLyricFromPlayer(
    async () => {
      throw new Error("backend should not be called when player state says lyric is locked");
    },
    {
      knownOpen: true,
      knownLocked: true,
      getState: async () => {
        throw new Error("state query unavailable");
      },
      setLocked: async () => {},
      broadcastSettings: () => {},
    },
  ))),
  { action: "unlocked", open: true, locked: false, message: "桌面歌词已解锁" },
  "player desktop lyric helper should unlock from known runtime lock state when events were missed",
);

assert.deepEqual(
  JSON.parse(JSON.stringify(await toggleDesktopLyricFromPlayer(
    async () => ({
      action: "opened",
      open: true,
      locked: false,
      message: "桌面歌词已打开",
    }),
    {
      knownOpen: false,
      readPersistedLocked: () => true,
      getState: async () => {
        throw new Error("state query unavailable");
      },
      setLocked: async () => {},
      broadcastSettings: () => {},
    },
  ))),
  { action: "opened", open: true, locked: false, message: "桌面歌词已打开" },
  "player desktop lyric helper should ignore stale persisted lock state",
);

assert.deepEqual(
  JSON.parse(JSON.stringify(await toggleDesktopLyricFromPlayer(
    async () => {
      throw new Error("backend toggle should not be called when Rust state says lyric is locked");
    },
    {
      knownOpen: false,
      knownLocked: false,
      readPersistedLocked: () => false,
      getState: async () => ({ open: true, locked: true }),
      setLocked: async () => {},
      broadcastSettings: () => {},
    },
  ))),
  { action: "unlocked", open: true, locked: false, message: "桌面歌词已解锁" },
  "player desktop lyric helper should use Rust lyric state instead of stale frontend state",
);

assert.deepEqual(
  JSON.parse(JSON.stringify(await toggleDesktopLyricFromPlayer(
    async () => ({
      action: "opened",
      open: true,
      locked: false,
      message: "桌面歌词已打开",
    }),
    {
      readPersistedLocked: () => true,
      getState: async () => new Promise(() => {}),
      stateQueryTimeoutMs: 1,
      setLocked: async () => {},
      broadcastSettings: () => {},
    },
  ))),
  { action: "opened", open: true, locked: false, message: "桌面歌词已打开" },
  "player desktop lyric helper should not unlock from stale persisted state when backend state query times out",
);

assert.deepEqual(
  JSON.parse(JSON.stringify(await toggleDesktopLyricFromPlayer(
    async () => ({
      action: "closed",
      open: false,
      locked: false,
      message: "桌面歌词已关闭",
    }),
    {
      readPersistedLocked: () => true,
      getState: async () => ({ open: true, locked: false }),
      setLocked: async () => {},
      broadcastSettings: () => {},
    },
  ))),
  { action: "closed", open: false, locked: false, message: "桌面歌词已关闭" },
  "player desktop lyric helper should trust backend runtime false over stale frontend persistence",
);

assert.deepEqual(
  JSON.parse(JSON.stringify(await toggleDesktopLyricFromPlayer(
    async () => {
      throw new Error("backend toggle should not close an open lyric window when lock state is unknown");
    },
    {
      knownOpen: true,
      knownLocked: false,
      unlockFirst: async () => {
        throw new Error("unlock-first unavailable");
      },
      getState: async () => {
        throw new Error("state query unavailable");
      },
      setLocked: async () => {},
      broadcastSettings: () => {},
    },
  ))),
  { action: "unlocked", open: true, locked: false, message: "桌面歌词已解锁" },
  "player desktop lyric helper should fail safe by unlocking an open lyric window when backend lock state is unknown",
);

assert.deepEqual(
  JSON.parse(JSON.stringify(await toggleDesktopLyricFromPlayer(
    async () => {
      throw new Error("lock-aware backend toggle unavailable");
    },
    {
      knownOpen: true,
      knownLocked: false,
      unlockFirst: async () => ({ unlocked: false, open: true, locked: false }),
      getState: async () => ({ open: true, locked: false }),
      setLocked: async () => {},
      broadcastSettings: () => {},
    },
  ))),
  { action: "unlocked", open: true, locked: false, message: "桌面歌词已解锁" },
  "player desktop lyric helper should not raw-toggle-close an open lyric window when lock-aware backend toggle fails",
);

const toPlain = (value) => JSON.parse(JSON.stringify(value));

const lines = [
  { time: 0, text: "第一句" },
  { time: 10, text: "正在唱", tr: "Now singing" },
  { time: 20, text: "下一句" },
  { time: 30, text: "再下一句" },
];

assert.deepEqual(
  toPlain(buildDesktopLyricLines({
    lines,
    currentLine: 1,
    hasCurrentMusic: true,
    showNextLine: true,
    singleLine: false,
    maxLineNum: 3,
    showTranslation: true,
  })),
  [
    { key: "current-1", role: "current", text: "正在唱", translation: "Now singing" },
    { key: "next-2", role: "next", text: "下一句" },
    { key: "next-3", role: "next", text: "再下一句" },
  ],
  "multi-line mode should include current lyric, translation, and upcoming lines",
);

assert.deepEqual(
  toPlain(buildDesktopLyricLines({
    lines,
    currentLine: 1,
    hasCurrentMusic: true,
    showNextLine: true,
    singleLine: true,
    maxLineNum: 3,
    showTranslation: true,
  })),
  [
    { key: "current-1", role: "current", text: "正在唱", translation: "Now singing" },
  ],
  "single-line mode should ignore next lines",
);

assert.deepEqual(
  toPlain(buildDesktopLyricLines({
    lines,
    currentLine: -1,
    hasCurrentMusic: true,
    showNextLine: false,
    singleLine: false,
    maxLineNum: 2,
    showTranslation: false,
  })),
  [
    { key: "current-0", role: "current", text: "第一句" },
  ],
  "before the first timestamp should show the first lyric as the current line",
);

assert.deepEqual(
  toPlain(buildDesktopLyricLines({
    lines: [],
    currentLine: -1,
    hasCurrentMusic: true,
    showNextLine: true,
    singleLine: false,
    maxLineNum: 2,
    showTranslation: true,
  })),
  [
    { key: "empty", role: "empty", text: "暂无歌词" },
  ],
  "playing music without lyrics should show an empty-lyrics hint",
);

assert.deepEqual(
  toPlain(buildDesktopLyricLines({
    lines: [],
    currentLine: -1,
    hasCurrentMusic: false,
    showNextLine: true,
    singleLine: false,
    maxLineNum: 2,
    showTranslation: true,
  })),
  [
    { key: "no-music", role: "empty", text: "打开主窗口选首歌吧" },
  ],
  "no current music should show the no-music hint",
);

assert.equal(
  detectWindowRoleFromParts("lyric", ""),
  "lyric",
  "lyric window label should select the desktop lyric role even without a hash route",
);

assert.equal(
  detectWindowRoleFromParts("main", "#/lyric"),
  "lyric",
  "hash route should remain a fallback for lyric role detection",
);

assert.equal(
  detectWindowRoleFromParts("main", "#/settings"),
  "main",
  "main label without lyric hash should select the main role",
);

assert.equal(
  detectWindowRoleFromParts("lyric-unlock", ""),
  "lyric-unlock",
  "locked desktop lyric should expose a small unlock hot-zone window",
);

const lyricWindowViewSource = readFileSync(resolve(__dirname, "../src/views/LyricWindowView.tsx"), "utf8");
assert.match(
  lyricWindowViewSource,
  /startDragging\(/,
  "desktop lyric toolbar should explicitly start window dragging",
);
assert.match(
  lyricWindowViewSource,
  /getLyricWindowState/,
  "desktop lyric window should initialize its lock UI from backend runtime state",
);
assert.doesNotMatch(
  lyricWindowViewSource,
  /setLocked\(s\.lyricLocked\)/,
  "desktop lyric window should not initialize lock UI directly from possibly stale settings",
);
assert.match(
  lyricWindowViewSource,
  /onMouseDown=\{startWindowDrag\}/,
  "desktop lyric window should start dragging from normal mouse down events",
);
assert.match(
  lyricWindowViewSource,
  /width:\s*min\(680px,\s*calc\(100%\s*-\s*28px\)\)/,
  "desktop lyric toolbar should be compact instead of spanning the full lyric window",
);
assert.match(
  lyricWindowViewSource,
  /await setLyricWindowLocked\(next,\s*lockEpoch,\s*"lyric-window"\)[\s\S]*broadcastLyricSettings\(\{ lyricLocked: next \}\)/,
  "desktop lyric lock button should only broadcast lock state after the backend confirms the lock change",
);
assert.doesNotMatch(
  lyricWindowViewSource,
  /setLocked\(next\)[\s\S]*await setLyricWindowLocked\(next\)/,
  "desktop lyric lock button should not hide its own controls before the backend confirms locking",
);
assert.doesNotMatch(
  lyricWindowViewSource,
  /onMouseDown=\{prepareLockToggle\}/,
  "desktop lyric lock button should not create a separate mouse-down lock intent before the click lock request",
);
assert.doesNotMatch(
  lyricWindowViewSource,
  /persistLyricLocked/,
  "desktop lyric lock button should not write a local locked=true state before backend confirmation",
);
assert.match(
  lyricWindowViewSource,
  /prepareLyricWindowLock\(\)/,
  "desktop lyric lock button should write lock intent into the Rust backend before locking",
);
assert.match(
  lyricWindowViewSource,
  /const lockEpoch = next \? await prepareLyricWindowLock\(\) : undefined/,
  "desktop lyric lock button should tag lock requests with the backend lock epoch",
);
assert.match(
  lyricWindowViewSource,
  /await setLyricWindowLocked\(next,\s*lockEpoch,\s*"lyric-window"\)/,
  "desktop lyric lock button should pass the lock epoch so stale lock requests can be ignored",
);
assert.doesNotMatch(
  lyricWindowViewSource,
  /prepareLockToggle[\s\S]*broadcastLyricSettings\(\{ lyricLocked: true \}\)/,
  "desktop lyric lock intent should not broadcast a real locked state back into the lyric window before backend confirmation",
);

const appSource = readFileSync(resolve(__dirname, "../src/App.tsx"), "utf8");
assert.match(
  appSource,
  /LyricUnlockView/,
  "app should render a small unlock view for locked desktop lyrics",
);

const lyricWindowRustSource = readFileSync(resolve(__dirname, "../src-tauri/src/lyric_window.rs"), "utf8");
const lyricWindowRustProductionSource = lyricWindowRustSource;
assert.match(
  lyricWindowRustSource,
  /LYRIC_LOCKED/,
  "desktop lyric backend should keep runtime lock state instead of relying only on settings",
);
assert.doesNotMatch(
  lyricWindowRustSource,
  /LYRIC_LOCK_INTENT/,
  "desktop lyric backend should not keep a temporary runtime lock intent",
);
assert.match(
  lyricWindowRustSource,
  /LYRIC_LOCK_RUNTIME_KNOWN/,
  "desktop lyric backend should know when runtime lock state is authoritative over stale settings",
);
assert.match(
  lyricWindowRustSource,
  /LYRIC_LOCK_EPOCH/,
  "desktop lyric backend should invalidate stale delayed lock requests",
);
assert.match(
  lyricWindowRustSource,
  /LYRIC_CREATE_PENDING/,
  "desktop lyric backend should track a pending create so controls do not misread opening lyrics as closed",
);
assert.match(
  lyricWindowRustSource,
  /LYRIC_WINDOW_EPOCH/,
  "desktop lyric backend should bind lock requests to the current lyric window lifetime",
);
assert.match(
  lyricWindowRustSource,
  /LYRIC_PENDING_LOCK_TOKEN/,
  "desktop lyric backend should remember only the latest prepared lock token",
);
assert.match(
  lyricWindowRustSource,
  /fn has_runtime_lock_target/,
  "desktop lyric backend should keep active runtime lock targets",
);
assert.match(
  lyricWindowRustSource,
  /pub fn is_open\(app: &AppHandle\) -> bool \{[\s\S]*LYRIC_CREATE_PENDING\.load\(Ordering::SeqCst\)[\s\S]*has_runtime_lock_target\(\)[\s\S]*LYRIC_UNLOCK_LABEL[\s\S]*\}/,
  "desktop lyric open query should include pending create and lock evidence, not only the raw window handle",
);
assert.match(
  lyricWindowRustSource,
  /fn has_pending_lock_request/,
  "desktop lyric backend should let player controls cancel a prepared lock request before it is applied",
);
assert.doesNotMatch(
  lyricWindowRustProductionSource,
  /LYRIC_LOCKED\.store\(false,\s*Ordering::SeqCst\)/,
  "desktop lyric runtime lock state should only be changed through set_locked",
);
assert.match(
  lyricWindowRustSource,
  /open: is_open\(app\) \|\| create_pending \|\| runtime_target \|\| \(!runtime_known && unlock_window\)/,
  "desktop lyric state should treat an asynchronously opening lyric window as open",
);
assert.match(
  lyricWindowRustSource,
  /locked: runtime_target \|\| unlock_window/,
  "desktop lyric state should not use persisted settings for lock state",
);
assert.match(
  lyricWindowRustSource,
  /let initial_locked = if runtime_known \{[\s\S]*runtime_target[\s\S]*\} else \{[\s\S]*false[\s\S]*\};/,
  "desktop lyric window creation should default to unlocked instead of persisted lock settings",
);
assert.doesNotMatch(
  lyricWindowRustSource,
  /fn create[\s\S]*LYRIC_LOCK_EPOCH\.fetch_add/,
  "desktop lyric window creation should not invalidate pending unlock persistence",
);
assert.match(
  lyricWindowRustSource,
  /LYRIC_LOCKED\.store\(locked,\s*Ordering::SeqCst\)[\s\S]*emit\("lyric-settings-changed"[\s\S]*schedule_apply_locked_window_state\(app,\s*locked\)/,
  "desktop lyric backend should apply lock state and notify windows without persisting lock state",
);
assert.doesNotMatch(
  lyricWindowRustSource,
  /fn schedule_persist_lock_setting/,
  "desktop lyric backend should not persist lock settings",
);
assert.doesNotMatch(
  lyricWindowRustSource,
  /persist lock setting failed/,
  "desktop lyric backend should not have async lock persistence failures",
);
assert.doesNotMatch(
  lyricWindowRustSource,
  /pub fn set_locked[\s\S]*apply_locked_window_state\(app,\s*locked\)\?/,
  "desktop lyric lock IPC should not synchronously apply OS-level mouse passthrough",
);
assert.match(
  lyricWindowRustSource,
  /get_webview_window\(LYRIC_UNLOCK_LABEL\)\.is_some\(\)/,
  "desktop lyric backend should treat the unlock hot-zone as evidence that the lyric window is locked",
);
assert.match(
  lyricWindowRustSource,
  /pub fn prepare_lock_intent/,
  "desktop lyric backend should expose an epoch preparer before lock IPC",
);
assert.match(
  lyricWindowRustSource,
  /pub fn prepare_lock_intent[\s\S]*fetch_add\(1,\s*Ordering::SeqCst\)/,
  "desktop lyric backend should assign an epoch to each pending lock request",
);
assert.match(
  lyricWindowRustSource,
  /fn consume_pending_lock_token\(prepared_lock_token: u64\) -> Result<\(\), u64> \{[\s\S]*LYRIC_PENDING_LOCK_TOKEN[\s\S]*compare_exchange\([\s\S]*prepared_lock_token[\s\S]*0,[\s\S]*Ordering::SeqCst[\s\S]*Ordering::SeqCst[\s\S]*\)/,
  "desktop lyric backend should atomically consume lock tokens so unlock cannot race with a delayed lock request",
);
assert.match(
  lyricWindowRustProductionSource,
  /consume_pending_lock_token\(prepared_lock_token\)/,
  "desktop lyric lock requests should consume the prepared token before applying locked=true",
);
assert.match(
  lyricWindowRustSource,
  /locked && source != "lyric-window"/,
  "desktop lyric backend should only allow lyric-window to write locked=true",
);
assert.doesNotMatch(
  lyricWindowRustSource,
  /set locked without epoch assigned/,
  "desktop lyric backend should not auto-assign epochs for unprepared lock=true requests",
);
assert.doesNotMatch(
  lyricWindowRustSource,
  /schedule_persist_lock_setting\(app,\s*locked,\s*current_lock_epoch\)/,
  "desktop lyric backend should not schedule async lock persistence",
);
assert.doesNotMatch(
  lyricWindowRustSource,
  /skip stale lock setting persist/,
  "desktop lyric backend should not need stale async lock persistence guards",
);
assert.doesNotMatch(
  lyricWindowRustSource,
  /prepare_lock_intent[\s\S]*lyric-settings-changed/,
  "desktop lyric backend lock-intent marker should not emit a real locked setting before backend confirmation",
);
assert.match(
  lyricWindowRustSource,
  /pub fn prepare_lock_intent\(_app: &AppHandle\) -> u64 \{[\s\S]*LYRIC_WINDOW_EPOCH\.load\(Ordering::SeqCst\)[\s\S]*LYRIC_PENDING_LOCK_TOKEN\.store\(token,\s*Ordering::SeqCst\)[\s\S]*token\s*\}/,
  "desktop lyric backend lock preparer should bind the pending token to the current lyric window instance",
);
assert.doesNotMatch(
  lyricWindowRustSource,
  /fn has_runtime_lock_evidence|fn is_locked|pub fn toggle_locked/,
  "desktop lyric backend should not keep unused tray/settings lock helpers",
);
assert.match(
  lyricWindowRustSource,
  /let current = state\(app\);[\s\S]*let open = current\.open;[\s\S]*let locked = current\.locked;/,
  "player toggle should still unlock when the main lyric window handle is stale but lock evidence exists",
);
assert.match(
  lyricWindowRustSource,
  /set_ignore_cursor_events\(locked\)/,
  "desktop lyric lock state should directly control mouse passthrough",
);
assert.match(
  lyricWindowRustSource,
  /LYRIC_UNLOCK_LABEL/,
  "desktop lyric backend should manage a separate unlock hot zone",
);
assert.match(
  lyricWindowRustSource,
  /schedule_create_unlock_window\(app\)/,
  "locking desktop lyric should create the hover unlock button",
);
assert.match(
  lyricWindowRustSource,
  /schedule_apply_locked_window_state\(app,\s*locked\)/,
  "locking desktop lyric should schedule mouse passthrough after runtime state updates",
);
assert.match(
  lyricWindowRustSource,
  /fn schedule_apply_locked_window_state/,
  "desktop lyric backend should apply OS-level mouse passthrough asynchronously",
);
assert.match(
  lyricWindowRustSource,
  /if has_runtime_lock_target\(\) != locked \{[\s\S]*return;[\s\S]*\}/,
  "async mouse passthrough application should skip stale lock targets",
);
assert.match(
  lyricWindowRustSource,
  /if has_runtime_lock_target\(\) != locked/,
  "async mouse passthrough application should skip stale runtime lock targets",
);
assert.match(
  lyricWindowRustSource,
  /fn schedule_create_unlock_window/,
  "desktop lyric backend should create the unlock hot-zone asynchronously",
);
assert.match(
  lyricWindowRustSource,
  /if !has_runtime_lock_target\(\)[\s\S]*return;[\s\S]*create_unlock_window\(&app\)[\s\S]*if !has_runtime_lock_target\(\)[\s\S]*close_unlock_window\(&app\)/,
  "async unlock hot-zone creation should not leave a stale unlock window after the lyric is already unlocked",
);
assert.match(
  lyricWindowRustSource,
  /create unlock window failed/,
  "desktop lyric backend should log unlock hot-zone creation failures",
);
assert.match(
  lyricWindowRustSource,
  /lyric-window-open-changed/,
  "desktop lyric backend should emit window open-state changes",
);
assert.match(
  lyricWindowRustSource,
  /LYRIC_CREATE_PENDING\.store\(false,\s*Ordering::SeqCst\)/,
  "desktop lyric backend should clear pending create when opening is completed, cancelled, or failed",
);
assert.match(
  lyricWindowRustSource,
  /ensure_always_on_top_loop\(app\)/,
  "desktop lyric backend should reassert always-on-top while pinned",
);
assert.match(
  lyricWindowRustSource,
  /clear_always_on_top_loop\(\)/,
  "desktop lyric backend should stop the always-on-top loop when unpinned or closed",
);
assert.match(
  lyricWindowRustSource,
  /toggle_from_player/,
  "desktop lyric backend should expose a lock-aware player toggle action",
);
assert.match(
  lyricWindowRustSource,
  /unlock_from_player/,
  "desktop lyric backend should expose a player unlock-first action",
);
assert.match(
  lyricWindowRustSource,
  /unlock_from_player[\s\S]*has_pending_lock_request\(\)[\s\S]*set_locked\(app,\s*false,\s*None,\s*"player-unlock-first"\)/,
  "player unlock-first should cancel a pending lyric lock request before it can lock the window",
);
assert.match(
  lyricWindowRustSource,
  /let current = state\(app\);[\s\S]*let open = current\.open;[\s\S]*let locked = current\.locked;/,
  "player toggle should use the same backend-authoritative state as state queries",
);
assert.match(
  lyricWindowRustSource,
  /toggle_from_player[\s\S]*has_pending_lock_request\(\)[\s\S]*if open && \(locked \|\| pending_lock\)/,
  "player toggle should unlock instead of closing when a lyric lock request is still pending",
);
assert.match(
  lyricWindowRustSource,
  /!open && \(locked \|\| pending_lock\)/,
  "player toggle should clear stale runtime or pending lock state before opening a closed lyric window",
);
assert.doesNotMatch(
  lyricWindowRustSource,
  /patch_settings\(&app,\s*json!\(\{\s*"lyricLocked": locked\s*\}\)\)/,
  "desktop lyric backend should never write lyricLocked to settings",
);

const traySource = readFileSync(resolve(__dirname, "../src-tauri/src/tray.rs"), "utf8");
assert.doesNotMatch(
  traySource,
  /toggle-lyric-lock|锁定 \/ 解锁桌面歌词|tray-toggle-lock|toggle_locked/,
  "system tray should not expose an extra desktop lyric lock toggle",
);

const playerBarSource = readFileSync(resolve(__dirname, "../src/components/PlayerBar.tsx"), "utf8");
assert.match(
  playerBarSource,
  /lyric-window-open-changed/,
  "player bar should subscribe to desktop lyric open-state changes",
);
assert.match(
  playerBarSource,
  /toggleDesktopLyricFromPlayer/,
  "player bar desktop lyric button should use the shared lock-aware toggle helper",
);
assert.match(
  playerBarSource,
  /getLyricWindowState\(\)/,
  "player bar should initialize desktop lyric lock state from backend runtime state",
);
assert.doesNotMatch(
  playerBarSource,
  /loadSettings\(\)\.then\(\(settings\) => setLyricLocked\(settings\.lyricLocked\)\)/,
  "player bar should not initialize desktop lyric lock state from settings",
);
assert.doesNotMatch(
  playerBarSource,
  /toggleLyricWindow/,
  "player bar should not call the raw open-close lyric toggle directly",
);

const playerViewSource = readFileSync(resolve(__dirname, "../src/views/PlayerView.tsx"), "utf8");
assert.match(
  playerViewSource,
  /toggleDesktopLyricFromPlayer/,
  "fullscreen player desktop lyric button should use the shared lock-aware toggle helper",
);
assert.doesNotMatch(
  playerViewSource,
  /toggleLyricWindow/,
  "fullscreen player should not call the raw open-close lyric toggle directly",
);
assert.match(
  playerViewSource,
  /desktopLyricLocked/,
  "fullscreen player should track desktop lyric lock state for the control button",
);
assert.match(
  playerViewSource,
  /getLyricWindowState\(\)/,
  "fullscreen player should initialize desktop lyric lock state from backend runtime state",
);
assert.doesNotMatch(
  playerViewSource,
  /loadSettings\(\)\.then\(\(settings\) => setDesktopLyricLocked\(settings\.lyricLocked\)\)/,
  "fullscreen player should not initialize desktop lyric lock state from settings",
);

const tauriBridgeSource = readFileSync(resolve(__dirname, "../packages/tauri-bridge/src/index.ts"), "utf8");
assert.match(
  tauriBridgeSource,
  /toggleLyricWindowFromPlayer/,
  "tauri bridge should expose the lock-aware player toggle command",
);
assert.match(
  tauriBridgeSource,
  /unlockLyricWindowFromPlayer/,
  "tauri bridge should expose the player unlock-first command",
);
assert.match(
  tauriBridgeSource,
  /getLyricWindowState/,
  "tauri bridge should expose the backend-authoritative desktop lyric state",
);
assert.match(
  tauriBridgeSource,
  /prepareLyricWindowLock/,
  "tauri bridge should expose the desktop lyric lock-intent command",
);
assert.match(
  tauriBridgeSource,
  /prepareLyricWindowLock\(\): Promise<number>/,
  "tauri bridge should return the backend lock epoch from the lock-intent command",
);
assert.match(
  tauriBridgeSource,
  /setLyricWindowLocked\([\s\S]*locked: boolean,[\s\S]*lockEpoch\?: number,[\s\S]*lockSource\?: string/,
  "tauri bridge should pass lock epochs to the backend lock command",
);
assert.match(
  tauriBridgeSource,
  /lockSource/,
  "tauri bridge should pass a lock-source label to the backend lock command",
);

const desktopLyricToggleSource = readFileSync(resolve(__dirname, "../src/utils/desktopLyricToggle.ts"), "utf8");
assert.match(
  desktopLyricToggleSource,
  /lock-aware toggle command failed, falling back/,
  "player toggle helper should fall back if the lock-aware backend command is unavailable",
);
assert.match(
  desktopLyricToggleSource,
  /setLocked\(false\)/,
  "player toggle fallback should unlock locked desktop lyrics before closing",
);
assert.match(
  desktopLyricToggleSource,
  /setLyricWindowLocked\(locked,\s*undefined,\s*"player-helper"\)/,
  "player toggle fallback should label backend unlock writes as player-helper",
);
assert.doesNotMatch(
  desktopLyricToggleSource,
  /readPersistedLyricLocked|readPersistedLocked|persistedLocked/,
  "player toggle helper should not use persisted lyric lock state",
);

const useLyricsSource = readFileSync(resolve(__dirname, "../src/hooks/useLyrics.ts"), "utf8");
assert.match(
  useLyricsSource,
  /localStorage/,
  "lyrics hook should use a shared browser cache so fullscreen and desktop lyric windows see the same fetched lyrics",
);
assert.match(
  useLyricsSource,
  /readCachedLyrics/,
  "lyrics hook should read cached lyrics before fetching",
);
assert.match(
  useLyricsSource,
  /writeCachedLyrics/,
  "lyrics hook should write fetched lyrics for other windows",
);

const commandsSource = readFileSync(resolve(__dirname, "../src-tauri/src/commands.rs"), "utf8");
assert.match(
  commandsSource,
  /toggle_lyric_window_from_player/,
  "Rust commands should expose the lock-aware player toggle command",
);
assert.match(
  commandsSource,
  /unlock_lyric_window_from_player/,
  "Rust commands should expose the player unlock-first command",
);
assert.match(
  commandsSource,
  /get_lyric_window_state/,
  "Rust commands should expose backend-authoritative desktop lyric state",
);
assert.match(
  commandsSource,
  /prepare_lyric_window_lock/,
  "Rust commands should expose the desktop lyric lock-intent command",
);
assert.match(
  commandsSource,
  /lock_source:\s*Option<String>/,
  "Rust lock command should accept a lock-source label from the frontend",
);
assert.match(
  commandsSource,
  /unwrap_or\("ipc"\)/,
  "Rust lock command should default the lock-source label when older callers omit it",
);

const mainSource = readFileSync(resolve(__dirname, "../src-tauri/src/main.rs"), "utf8");
assert.doesNotMatch(
  mainSource,
  /mod shortcuts|shortcuts::setup|tauri_plugin_global_shortcut/,
  "desktop app should not register global shortcuts",
);
assert.match(
  mainSource,
  /commands::toggle_lyric_window_from_player/,
  "lock-aware player toggle command should be registered in Tauri invoke handler",
);
assert.match(
  mainSource,
  /commands::unlock_lyric_window_from_player/,
  "player unlock-first command should be registered in Tauri invoke handler",
);
assert.match(
  mainSource,
  /commands::get_lyric_window_state/,
  "backend-authoritative desktop lyric state command should be registered in Tauri invoke handler",
);
assert.match(
  mainSource,
  /commands::prepare_lyric_window_lock/,
  "desktop lyric lock-intent command should be registered in Tauri invoke handler",
);

const settingsSource = readFileSync(resolve(__dirname, "../src/views/SettingsView.tsx"), "utf8");
assert.doesNotMatch(
  settingsSource,
  /锁定窗口|桌面歌词锁定\/解锁/,
  "settings should not expose desktop lyric lock state or lock shortcuts",
);
assert.match(
  settingsSource,
  /toggleDesktopLyricFromPlayer/,
  "settings desktop lyric window button should use the shared lock-aware toggle helper",
);
assert.doesNotMatch(
  settingsSource,
  /toggleLyricWindow/,
  "settings desktop lyric window button should not call the raw lyric toggle directly",
);

const lyricUnlockViewSource = readFileSync(resolve(__dirname, "../src/views/LyricUnlockView.tsx"), "utf8");
assert.match(
  lyricUnlockViewSource,
  /opacity:\s*0/,
  "desktop lyric unlock button should be hidden until hover",
);
assert.match(
  lyricUnlockViewSource,
  /\.af-lyric-unlock-shell:hover\s+\.af-lyric-unlock-button/,
  "desktop lyric unlock button should appear when hovering the unlock hot zone",
);
assert.match(
  lyricUnlockViewSource,
  /broadcastLyricSettings\(\{ lyricLocked: false \}\)[\s\S]*await setLyricWindowLocked\(false,\s*undefined,\s*"lyric-unlock"\)/,
  "desktop lyric unlock hot-zone should broadcast unlocked state before changing window passthrough",
);

const capability = JSON.parse(readFileSync(resolve(__dirname, "../src-tauri/capabilities/default.json"), "utf8"));
assert.equal(
  capability.windows.includes("lyric-unlock"),
  true,
  "desktop lyric unlock hot-zone window should be included in Tauri capabilities",
);
assert.equal(
  capability.permissions.includes("core:window:allow-start-dragging"),
  true,
  "desktop lyric window should be allowed to call startDragging",
);
assert.equal(
  capability.permissions.includes("global-shortcut:default"),
  false,
  "desktop app should not request global shortcut permissions",
);

class FakeBroadcastChannel {
  static channels = new Map();

  constructor(name) {
    this.name = name;
    this.listeners = new Set();
    if (!FakeBroadcastChannel.channels.has(name)) {
      FakeBroadcastChannel.channels.set(name, new Set());
    }
    FakeBroadcastChannel.channels.get(name).add(this);
  }

  addEventListener(type, listener) {
    if (type === "message") this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === "message") this.listeners.delete(listener);
  }

  postMessage(data) {
    for (const channel of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (channel === this) continue;
      for (const listener of channel.listeners) {
        listener({ data });
      }
    }
  }

  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
    this.listeners.clear();
  }
}

function createFakeLocalStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const fakeLyricSettingsStorage = createFakeLocalStorage();

const tauriListeners = [];
const fakeStorageListeners = [];
const { broadcastLyricSettings, subscribeLyricSettings } = loadTsModule(
  "../src/stores/lyricSettingsSync.ts",
  {
    context: {
      BroadcastChannel: FakeBroadcastChannel,
      window: {
        localStorage: fakeLyricSettingsStorage,
        addEventListener: (eventName, listener) => {
          if (eventName === "storage") fakeStorageListeners.push(listener);
        },
        removeEventListener: (eventName, listener) => {
          if (eventName !== "storage") return;
          const index = fakeStorageListeners.indexOf(listener);
          if (index >= 0) fakeStorageListeners.splice(index, 1);
        },
      },
    },
    requireStubs: {
      "@tauri-apps/api/event": {
        listen: async (eventName, handler) => {
          tauriListeners.push({ eventName, handler });
          return () => {};
        },
      },
    },
  },
);

const receivedLyricSettings = [];
const unsubscribeLyricSettings = subscribeLyricSettings((patch) => {
  receivedLyricSettings.push(patch);
});
await Promise.resolve();

broadcastLyricSettings({ lyricLocked: true });
assert.equal(
  fakeLyricSettingsStorage.getItem("auralflow:desktop-lyric:locked"),
  null,
  "lyric settings broadcast should not persist desktop lyric lock state",
);
assert.deepEqual(
  receivedLyricSettings,
  [{ lyricLocked: true }],
  "lyric settings subscribers should receive BroadcastChannel patches",
);

assert.equal(
  tauriListeners[0]?.eventName,
  "lyric-settings-changed",
  "lyric settings subscribers should listen for Rust-side setting changes",
);
assert.equal(
  fakeStorageListeners.length,
  0,
  "lyric settings subscribers should not register a lock-state storage event listener",
);

const lyricSettingsSyncSource = readFileSync(resolve(__dirname, "../src/stores/lyricSettingsSync.ts"), "utf8");
assert.doesNotMatch(
  lyricSettingsSyncSource,
  /addEventListener\("storage"/,
  "lyric settings subscribers should not listen for localStorage lock-state changes",
);
assert.doesNotMatch(
  lyricSettingsSyncSource,
  /persistLyricLocked/,
  "lyric settings sync should not expose a direct lock-state persistence helper",
);

tauriListeners[0].handler({ payload: { lyricLocked: false } });
assert.equal(
  fakeLyricSettingsStorage.getItem("auralflow:desktop-lyric:locked"),
  null,
  "Rust-side lyric lock changes should not update persisted desktop lyric lock state",
);
assert.deepEqual(
  receivedLyricSettings,
  [{ lyricLocked: true }, { lyricLocked: false }],
  "lyric settings subscribers should receive Rust-side lock changes",
);
unsubscribeLyricSettings();

console.log("desktop lyric tests passed");
