const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { createLoader, mobileRequire, mobileRoot } = require("./helpers/loadTs.cjs");

const model = createLoader({})("src/services/historyGroupModel.ts");
const paletteModel = createLoader({})("src/services/themePaletteModel.ts");
const local = (year, month, day, hour = 0) => new Date(year, month - 1, day, hour).getTime();
const entry = (id, playedAt, extra = {}) => ({
  key: `tx:${id}`, song: { id, source: "tx", name: id, singer: "Test", interval: 100 }, playedAt, ...extra,
});
const now = local(2026, 10, 7, 12);
const today = local(2026, 10, 7);

function calendar(entries, month = today, selected = today, time = now) {
  assert.equal(typeof model.getHistoryCalendarDays, "function", "月历必须使用共享本地日期模型");
  return model.getHistoryCalendarDays(entries, month, selected, time);
}

test("只有真实历史日可选，合成、非法及未来时间不能冒充听歌日", () => {
  const records = [entry("real", local(2026, 10, 6, 23)), entry("same", local(2026, 10, 6, 1)),
    entry("unknown", today, { playedAtSynthetic: true }), entry("future", local(2026, 10, 8)),
    ...[0, -1, NaN, Infinity, Number.MAX_VALUE].map((time, i) => entry(`invalid${i}`, time))];
  const snapshot = [...records];
  const cells = calendar(records).filter(Boolean);
  assert.deepEqual(cells.filter((cell) => !cell.disabled).map((cell) => cell.dayStart), [local(2026, 10, 6)]);
  assert.equal(cells.find((cell) => cell.dayStart === today).selected, true);
  assert.deepEqual(records, snapshot);
  assert.equal(model.filterEntriesByDay(records, today)[0].key, "tx:unknown", "未知时间条目仍保留原有列表展示");
});

test("每个可选日期与列表中的真实记录一致，且空历史全部禁用", () => {
  const records = [entry("a", local(2026, 10, 2, 2)), entry("b", today), entry("c", local(2026, 9, 30, 23))];
  for (const cell of calendar(records).filter(Boolean)) {
    assert.equal(!cell.disabled, model.filterEntriesByDay(records, cell.dayStart).some(model.hasRealPlayedAt));
  }
  assert.ok(calendar([]).filter(Boolean).every((cell) => cell.disabled));
});

for (const [year, month, count] of [[2024, 2, 29], [2025, 2, 28], [2000, 2, 29], [2100, 2, 28], [2026, 8, 31]]) {
  test(`${year}年${month}月按完整周排列，月长为${count}`, () => {
    const start = local(year, month, 1);
    const cells = calendar([], start, start);
    assert.equal(cells.length % 7, 0);
    assert.equal(cells.findIndex(Boolean), new Date(start).getDay());
    assert.deepEqual(cells.filter(Boolean).map((cell) => new Date(cell.dayStart).getDate()), Array.from({ length: count }, (_, i) => i + 1));
    assert.equal(new Set(cells.filter(Boolean).map((cell) => cell.dayStart)).size, count);
  });
}

test("月导航先归一到月初，处理月底、跨年；日导航处理闰日", () => {
  assert.equal(typeof model.addMonths, "function");
  assert.equal(model.addMonths(local(2024, 1, 31), 1), local(2024, 2, 1));
  assert.equal(model.addMonths(local(2026, 1, 1), -1), local(2025, 12, 1));
  assert.equal(model.addMonths(local(2025, 12, 31), 1), local(2026, 1, 1));
  assert.equal(model.addDays(local(2024, 2, 28), 1), local(2024, 2, 29));
  assert.equal(model.addDays(local(2024, 2, 29), 1), local(2024, 3, 1));
  assert.equal(model.addDays(local(2026, 1, 1), -1), local(2025, 12, 31));
});

// 独立进程设置 TZ，避免 Windows 进程内切换时区和测试并发互相污染。
for (const [zone, date, hours] of [
  ["Asia/Shanghai", [2026, 10, 7], 24],
  ["America/New_York", [2026, 3, 8], 23],
  ["America/New_York", [2026, 11, 1], 25],
  ["Australia/Lord_Howe", [2026, 10, 4], 23.5],
  ["Australia/Lord_Howe", [2026, 4, 5], 24.5],
  ["America/Sao_Paulo", [2018, 11, 4], 23],
]) {
  test(`${zone} ${date.join("-")}：${hours}小时日的导航、筛选、标题和月历一致`, () => {
    const script = `
      const assert = require('node:assert/strict');
      const { createLoader } = require(${JSON.stringify(path.join(__dirname, "helpers/loadTs.cjs"))});
      const m = createLoader({})('src/services/historyGroupModel.ts');
      const [y, month, d] = ${JSON.stringify(date)};
      const start = new Date(y, month - 1, d).getTime();
      const end = new Date(y, month - 1, d + 1).getTime();
      assert.equal((end - start) / 3600000, ${hours}, '子进程必须使用指定时区');
      assert.equal(m.addDays(start, 1), end, '下一天必须是本地日界线');
      assert.equal(m.addDays(end, -1), start, '前一天不能按24小时倒推');
      const records = [start - 1, start, end - 1, end, end + 1].map((playedAt, key) => ({ key, song: {}, playedAt }));
      assert.deepEqual(m.filterEntriesByDay(records, start).map(e => e.key), [2, 1], '保留当天末尾且排除次日开头');
      assert.equal(m.formatHistoryDayTitle(start, end + 3600000), '昨天');
      Date.now = () => end + 3600000;
      assert.equal(m.groupHistoryEntries([records[1]])[0].title, '昨天');
      assert.equal(m.dayStartOf(Date.parse(new Date(end - 1).toISOString())), start, 'UTC时间戳按本地日归属');
      assert.equal(typeof m.getHistoryCalendarDays, 'function');
      const days = m.getHistoryCalendarDays(records, start, start, end);
      const selected = days.find(cell => cell && cell.dayStart === start);
      assert.equal(selected.disabled, false);
      assert.equal(selected.selected, true);
      const lateOnly = m.getHistoryCalendarDays([records[2]], start, start, end).filter(cell => cell && !cell.disabled);
      assert.deepEqual(lateOnly.map(cell => cell.dayStart), [start]);
    `;
    const child = spawnSync(process.execPath, ["-e", script], { env: { ...process.env, TZ: zone }, encoding: "utf8", timeout: 15000 });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr || child.stdout);
  });
}

// 执行真实 TSX 和主题 store；只替换原生边界及 React hooks。
// 依赖按需加载，SongList 保留真实组件和 props，但不展开无关播放器/下载 UI。
// 此 harness 不模拟 Yoga 布局、原生手势和屏幕阅读器。
function setupUI(t, { mode = "light", width = 390, height = 844, fontScale = 1 } = {}) {
  const React = mobileRequire("react");
  const ts = mobileRequire("typescript");
  const componentSlots = new Map();
  let slots;
  let cursor;
  t.mock.method(Date, "now", () => now);
  t.mock.method(React, "useState", (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    const state = slots;
    return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
  });
  t.mock.method(React, "useMemo", (build) => build());
  t.mock.method(React, "useCallback", (callback) => callback);
  t.mock.method(React, "useSyncExternalStore", (_subscribe, snapshot) => snapshot());
  t.mock.method(React, "useDebugValue", () => {});
  const native = {
    View: "View", Text: "Text", Pressable: "Pressable", Modal: "Modal", ScrollView: "ScrollView",
    Platform: { OS: "android", select: (options) => options.android ?? options.default },
    Appearance: { getColorScheme: () => mode },
    StyleSheet: { create: (styles) => styles, hairlineWidth: 1, absoluteFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } },
    useWindowDimensions: () => ({ width, height, fontScale, scale: 1 }),
  };
  const boundary = {
    react: React,
    "react-native": native,
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }) },
    "@react-native-async-storage/async-storage": { getItem: async () => null, setItem: async () => {} },
    "lucide-react-native": Object.fromEntries(["ChevronLeft", "ChevronRight", "ChevronDown", "X", "CalendarDays"].map((name) => [name, name])),
  };
  const cache = new Map();
  function load(base) {
    const full = path.resolve(mobileRoot, base);
    const filename = [full, `${full}.ts`, `${full}.tsx`, path.join(full, "index.ts")].find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
    assert.ok(filename, `组件/依赖尚未实现: ${base}`);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
      jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    }, fileName: filename }).outputText;
    function dependency(name) {
      if (Object.hasOwn(boundary, name)) return boundary[name];
      if (!name.startsWith("@/") && !name.startsWith(".")) return mobileRequire(name);
      const target = name.startsWith("@/") ? `src/${name.slice(2)}` : path.resolve(path.dirname(filename), name);
      return new Proxy({}, { get: (_, key) => key === "__esModule" ? true : load(target)[key] });
    }
    new Function("require", "module", "exports", code)(dependency, module, module.exports);
    return module.exports;
  }
  return {
    load,
    render(Component, props) {
      if (!componentSlots.has(Component)) componentSlots.set(Component, []);
      slots = componentSlots.get(Component);
      cursor = 0;
      return Component(props);
    },
    unmount(Component) { componentSlots.delete(Component); },
  };
}

function all(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => all(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...all(tree.props?.children, predicate)];
}
function byLabel(tree, label) {
  const nodes = all(tree, (node) => node.props?.accessibilityLabel === label);
  assert.equal(nodes.length, 1, `必须有唯一的 ${label}`);
  return nodes[0];
}
function press(node) {
  assert.notEqual(node.props.disabled, true, "禁止按下禁用控件");
  assert.equal(typeof node.props.onPress, "function");
  node.props.onPress();
}
function style(node) {
  const value = typeof node.props.style === "function" ? node.props.style({ pressed: false }) : node.props.style;
  return Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
}
function text(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree !== "object") return String(tree);
  return text(tree.props?.children);
}
function dateButton(tree, day) {
  return byLabel(tree, `${new Date(day).getFullYear()}年${new Date(day).getMonth() + 1}月${new Date(day).getDate()}日`);
}

for (const mode of ["light", "dark"]) {
  test(`${mode}：真实日期用主题正文字色，未知及未来日期禁用，选中状态可辨`, (t) => {
    const ui = setupUI(t, { mode });
    const { HistoryCalendar } = ui.load("src/components/HistoryCalendar.tsx");
    const palette = paletteModel.buildThemePalette(mode);
    const chosen = [];
    const tree = ui.render(HistoryCalendar, { entries: [entry("real", today), entry("fake", local(2026, 10, 6), { playedAtSynthetic: true }), entry("future", local(2026, 10, 8))], selectedDay: today, palette, onSelect: (day) => chosen.push(day), onClose() {} });
    const selected = dateButton(tree, today);
    assert.equal(selected.props.accessibilityState.selected, true);
    assert.equal(selected.props.accessibilityState.disabled, false);
    const selectedText = all(selected, (node) => node.type === "Text")[0];
    assert.equal(style(selectedText).color, palette.text);
    assert.ok(all(selected, (node) => style(node).borderColor === palette.text && style(node).backgroundColor === palette.surfaceStrong).length > 0, "选中态不只依赖文字颜色");
    for (const day of [local(2026, 10, 5), local(2026, 10, 6), local(2026, 10, 8)]) {
      const button = dateButton(tree, day);
      assert.equal(button.props.disabled, true);
      assert.equal(button.props.accessibilityState.disabled, true);
      assert.equal(style(all(button, (node) => node.type === "Text")[0]).color, palette.textSubtle);
      assert.equal(button.props.onPress, undefined, "禁用日不注册跳转回调");
    }
    press(selected);
    assert.deepEqual(chosen, [today]);
  });
}

test("点击日期标题打开月历，切月选择真实日期，关闭后列表/播放/删除对应当天", (t) => {
  const ui = setupUI(t);
  const { HistorySection } = ui.load("src/components/HistorySection.tsx");
  const { HistoryCalendar } = ui.load("src/components/HistoryCalendar.tsx");
  const { SongList } = ui.load("src/components/SongList.tsx");
  const previousDay = local(2026, 9, 30);
  const records = [entry("today", today), entry("early", previousDay), entry("late", previousDay + 3600000)];
  const plays = [], deletes = [];
  const props = { entries: records, onPlay: (...args) => plays.push(args), onDelete: (...args) => deletes.push(args) };
  const render = () => ui.render(HistorySection, props);
  let tree = render();
  assert.equal(all(tree, (node) => node.type === HistoryCalendar).length, 0);
  press(byLabel(tree, "打开历史日历"));
  tree = render();
  assert.equal(byLabel(tree, "打开历史日历").props.accessibilityState.expanded, true);
  const calendarNode = all(tree, (node) => node.type === HistoryCalendar)[0];
  let popup = ui.render(HistoryCalendar, calendarNode.props);
  assert.equal(byLabel(popup, "下个月").props.disabled, true);
  press(byLabel(popup, "上个月"));
  popup = ui.render(HistoryCalendar, calendarNode.props);
  assert.match(text(popup), /2026年9月/);
  press(dateButton(popup, previousDay));
  tree = render();
  assert.equal(all(tree, (node) => node.type === HistoryCalendar).length, 0);
  assert.equal(byLabel(tree, "打开历史日历").props.accessibilityState.expanded, false);
  ui.unmount(HistoryCalendar);
  const list = all(tree, (node) => node.type === SongList)[0];
  assert.deepEqual(list.props.songs.map((song) => song.id), ["late", "early"]);
  list.props.onPlay(list.props.songs[1], 1);
  assert.deepEqual(plays, [[list.props.songs, 1]]);
  list.props.onDelete(list.props.songs[0]);
  assert.deepEqual(deletes, [[list.props.songs[0], previousDay]]);
  press(byLabel(tree, "打开历史日历"));
  popup = ui.render(HistoryCalendar, all(render(), (node) => node.type === HistoryCalendar)[0].props);
  assert.equal(dateButton(popup, previousDay).props.accessibilityState.selected, true);
  assert.match(text(popup), /2026年9月/);
});

for (const close of ["关闭历史日历", "遮罩关闭历史日历", "返回键"]) {
  test(`弹窗通过${close}关闭，不改变所选日期；重新打开重置浏览月份`, (t) => {
    const ui = setupUI(t);
    const { HistorySection } = ui.load("src/components/HistorySection.tsx");
    const { HistoryCalendar } = ui.load("src/components/HistoryCalendar.tsx");
    const props = { entries: [], onPlay() {} };
    const render = () => ui.render(HistorySection, props);
    press(byLabel(render(), "打开历史日历"));
    let popup = ui.render(HistoryCalendar, all(render(), (node) => node.type === HistoryCalendar)[0].props);
    press(byLabel(popup, "上个月"));
    popup = ui.render(HistoryCalendar, all(render(), (node) => node.type === HistoryCalendar)[0].props);
    if (close === "返回键") all(popup, (node) => node.type === "Modal")[0].props.onRequestClose();
    else press(byLabel(popup, close));
    assert.equal(all(render(), (node) => node.type === HistoryCalendar).length, 0);
    assert.match(text(byLabel(render(), "打开历史日历")), /今天/);
    ui.unmount(HistoryCalendar);
    press(byLabel(render(), "打开历史日历"));
    popup = ui.render(HistoryCalendar, all(render(), (node) => node.type === HistoryCalendar)[0].props);
    assert.match(text(popup), /2026年10月/);
    assert.ok(all(popup, (node) => node.props?.accessibilityState?.selected).every((node) => node.props.disabled));
  });
}

test("保留前后一天箭头，今天禁止向未来导航", (t) => {
  const ui = setupUI(t);
  const { HistorySection } = ui.load("src/components/HistorySection.tsx");
  const props = { entries: [], onPlay() {} };
  const render = () => ui.render(HistorySection, props);
  assert.equal(byLabel(render(), "后一天").props.disabled, true);
  press(byLabel(render(), "前一天"));
  assert.match(text(byLabel(render(), "打开历史日历")), /昨天/);
  press(byLabel(render(), "后一天"));
  assert.match(text(byLabel(render(), "打开历史日历")), /今天/);
});

for (const [width, height, fontScale] of [[320, 568, 1], [844, 390, 2.5]]) {
  test(`${width}x${height} 字号倍率${fontScale}：内容可纵向滚动，网格可横向滚动，触控至少44`, (t) => {
    const ui = setupUI(t, { width, height, fontScale });
    const { HistoryCalendar } = ui.load("src/components/HistoryCalendar.tsx");
    const tree = ui.render(HistoryCalendar, { entries: [entry("real", today)], selectedDay: today, palette: paletteModel.buildThemePalette("light"), onSelect() {}, onClose() {} });
    const backdrop = style(byLabel(tree, "遮罩关闭历史日历"));
    assert.equal(backdrop.position, "absolute");
    for (const edge of ["top", "right", "bottom", "left"]) assert.equal(backdrop[edge], 0);
    const scrolls = all(tree, (node) => node.type === "ScrollView");
    assert.ok(scrolls.some((node) => !node.props.horizontal));
    assert.ok(scrolls.some((node) => node.props.horizontal));
    const cell = dateButton(tree, today);
    assert.ok(style(cell).minHeight >= 44);
    assert.ok(style(cell).width >= 44);
    assert.ok(style(cell).width >= 14 * fontScale * 2, "双位数字不能被大字体挤出单元格");
    assert.ok(all(tree, (node) => style(node).maxHeight <= height - 40).length > 0, "面板必须限制在安全区可用高度内");
  });
}
