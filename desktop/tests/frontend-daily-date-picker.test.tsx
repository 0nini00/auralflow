import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyRecommendView } from '../src/views/DailyRecommendView';
import { useDiscoveryStore } from '../src/stores/discoveryStore';
import { useWyAccountStore } from '../src/stores/wyAccountStore';


// playerStore 在模块顶层执行 new Audio()，node 环境没有这个全局；
// vi.hoisted 在 import 之前跑，才能挡住模块初始化。
vi.hoisted(() => {
  class StubAudio {
    src = '';
    volume = 1;
    currentTime = 0;
    duration = 0;
    paused = true;
    preload = '';
    play() {
      return Promise.resolve();
    }
    pause() {}
    load() {}
    addEventListener() {}
    removeEventListener() {}
  }
  (globalThis as unknown as { Audio: unknown }).Audio = StubAudio;
});

// 「今日」前缀由组件按真实系统日期判断，测试也得用当天日期才能命中该分支
const now = new Date();
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const YESTERDAY = '2024-03-05';
let renderer: ReactTestRenderer;
let keydownHandlers: Array<(event: { key: string }) => void> = [];
let scrollHandlers: Array<() => void> = [];

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('');
}

function mount() {
  act(() => {
    renderer = create(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DailyRecommendView />
      </MemoryRouter>,
    );
  });
}

const trigger = () => renderer.root.findByProps({ className: 'af-daily-date-trigger' });
const items = () => renderer.root.findAllByProps({ role: 'menuitemradio' });

/** 触发器要用事件里的 currentTarget 定位；测试环境没有布局，给个固定矩形即可 */
function openMenu() {
  const anchor = {
    getBoundingClientRect: () => ({ top: 120, bottom: 150, left: 24, right: 172, width: 148, height: 30 }),
  };
  act(() => trigger().props.onClick({ currentTarget: anchor }));
}

beforeEach(() => {
  keydownHandlers = [];
  scrollHandlers = [];
  vi.stubGlobal('document', {
    documentElement: { classList: { add: vi.fn(), remove: vi.fn() } },
    // nodeType:1 过 react-dom 的容器校验，children 给 test-renderer 的 appendChild/removeChild 用
    body: { nodeType: 1, children: [] },
  });
  vi.stubGlobal('window', {
    innerWidth: 1366,
    innerHeight: 768,
    addEventListener: vi.fn((type: string, handler: never) => {
      if (type === 'keydown') keydownHandlers.push(handler);
      if (type === 'scroll') scrollHandlers.push(handler);
    }),
    removeEventListener: vi.fn(),
  });
  useWyAccountStore.setState({
    isLoaded: true,
    account: { uid: '9', nickname: 'tester', avatarUrl: '', vipType: 0, isVip: false },
  });
  useDiscoveryStore.setState({
    daily: [],
    dailyLoading: false,
    dailyError: '',
    dailyDate: TODAY,
    dailySelectedDate: TODAY,
    dailyHistory: [
      { date: TODAY, songs: [], cachedAt: 2 },
      { date: YESTERDAY, songs: [], cachedAt: 1 },
    ],
    initializeDaily: vi.fn(async () => undefined) as never,
  });
});

afterEach(() => {
  act(() => renderer?.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('每日推荐 · 推荐日期下拉', () => {
  it('展开后列出全部历史日期，今日带前缀，选中项带勾选', () => {
    mount();
    expect(items()).toHaveLength(0);

    openMenu();
    const list = items();
    expect(list).toHaveLength(2);
    expect(list.map((node) => text(node))).toEqual([`今日 · ${TODAY}`, YESTERDAY]);

    const checked = list.filter((node) => node.props['aria-checked'] === true);
    expect(checked).toHaveLength(1);
    expect(text(checked[0])).toContain(TODAY);
    expect(trigger().props['aria-expanded']).toBe(true);
  });

  it('选中某一天后写回 store 并收起菜单', () => {
    mount();
    openMenu();
    act(() => items()[1].props.onClick());
    expect(useDiscoveryStore.getState().dailySelectedDate).toBe(YESTERDAY);
    expect(items()).toHaveLength(0);
    expect(trigger().props['aria-expanded']).toBe(false);
  });

  it('Esc、点空白、滚动三条路都能收起', () => {
    mount();

    openMenu();
    act(() => keydownHandlers.forEach((handler) => handler({ key: 'Escape' })));
    expect(items()).toHaveLength(0);

    openMenu();
    act(() => renderer.root.findByProps({ className: 'af-add-menu-backdrop' }).props.onClick());
    expect(items()).toHaveLength(0);

    openMenu();
    act(() => scrollHandlers.forEach((handler) => handler({ target: { closest: () => null } })));
    expect(items()).toHaveLength(0);
  });

  it('没有历史快照时触发器禁用、不会展开', () => {
    useDiscoveryStore.setState({ dailyHistory: [], dailySelectedDate: '' });
    mount();
    expect(trigger().props.disabled).toBe(true);
    openMenu();
    expect(items()).toHaveLength(0);
  });

  it('日期很多时限高并改为内部滚动，内部滚动不会关掉菜单', () => {
    const many = Array.from({ length: 40 }, (_, index) => `2024-01-${String(index + 1).padStart(2, '0')}`);
    useDiscoveryStore.setState({ dailyHistory: many.map((date) => ({ date, songs: [], cachedAt: 0 })) });
    mount();
    openMenu();

    expect(items()).toHaveLength(40);
    const menu = renderer.root.findByProps({ role: 'menu' });
    expect(menu.props.style.maxHeight).toBeGreaterThan(0);
    expect(menu.props.style.maxHeight).toBeLessThanOrEqual(320);
    expect(menu.props.style.overflowY).toBe('auto');

    // 菜单内部滚动：不能关
    act(() => scrollHandlers.forEach((handler) => handler({ target: { closest: () => ({}) } })));
    expect(items()).toHaveLength(40);

    // 页面滚动：仍然要关
    act(() => scrollHandlers.forEach((handler) => handler({ target: { closest: () => null } })));
    expect(items()).toHaveLength(0);
  });
});
