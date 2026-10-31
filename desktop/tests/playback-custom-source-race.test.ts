import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';

const fixture = vi.hoisted(() => {
  const state = {
    featureEnabled: true,
    featureReady: true,
    sources: [] as Array<{ id: string; name: string; enabled: boolean }>,
    applyRuntimeUpdateAlert: vi.fn(),
  };
  let version = 0;
  let controller = new AbortController();
  const access = {
    capture() {
      const captured = version;
      const signal = controller.signal;
      const isActive = () => state.featureReady && state.featureEnabled && version === captured && !signal.aborted;
      const assertActive = () => { if (!isActive()) throw new Error('LX 未启用或操作已失效'); };
      assertActive();
      return { signal, isActive, assertActive };
    },
  };
  return {
    state,
    access,
    persistence: { ready: Promise.resolve() },
    runtime: vi.fn(),
    toggle(enabled: boolean) { controller.abort(); controller = new AbortController(); version++; state.featureEnabled = enabled; },
  };
});
vi.mock('../src/stores/customSourceStore', () => ({
  useCustomSourceStore: { getState: () => fixture.state },
  customSourceAccess: fixture.access,
  customSourcePersistence: fixture.persistence,
}));
vi.mock('../src/services/customSourceRuntime', () => ({ requestCustomSourceMusicUrl: fixture.runtime }));

interface Plan {
  delayMs: number;
  url?: string;
  quality?: string;
  error?: string;
}
type Plans = Record<string, Record<string, Plan>>;

const music = { id: '003QrnHn2kR4FD', source: 'tx', name: '倒影', singer: '周杰伦', interval: 250 } as MusicInfo;

function source(id: string, name = id) {
  return { id, name, enabled: true };
}

function installRuntime(plans: Plans, calls: Array<{ name: string; quality: string }>) {
  fixture.runtime.mockImplementation((api: { name: string }, _music: MusicInfo, quality: string) => {
    calls.push({ name: api.name, quality });
    const plan = plans[api.name]?.[quality];
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (!plan) reject(new Error(`无该档计划 ${api.name}/${quality}`));
        else if (plan.error) reject(new Error(plan.error));
        else resolve({ url: plan.url, quality: plan.quality ?? quality });
      }, plan?.delayMs ?? 0);
    });
  });
}

function tracker() {
  const state = { settled: false, value: undefined as { url: string; quality: string } | undefined, error: undefined as unknown };
  return {
    state,
    watch(promise: Promise<{ url: string; quality: string }>) {
      promise.then(
        (value) => { state.settled = true; state.value = value; },
        (error) => { state.settled = true; state.error = error; },
      );
      return promise;
    },
  };
}

async function loadBackend() {
  const { customSourceBackend } = await import('../src/services/playback/customSourceBackend');
  return customSourceBackend;
}

describe('自定义源按序交错竞速', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.useFakeTimers();
    fixture.toggle(true);
    fixture.state.featureReady = true;
    fixture.state.sources = [source('hyw', 'HYWmusic_公益版')];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('慢源响应 3.3s 不被 2.5s 预算击杀,低档达标结果被接受', async () => {
    const calls: Array<{ name: string; quality: string }> = [];
    installRuntime({ HYWmusic_公益版: {
      flac24bit: { delayMs: 100, error: '无 flac24bit' },
      flac: { delayMs: 3300, url: 'https://cdn/flac', quality: 'flac' },
    } }, calls);
    const backend = await loadBackend();
    const track = tracker();
    const pending = track.watch(
      backend.resolve({ primary: music, qualityPreference: ['flac24bit', 'flac'] }) as Promise<{ url: string; quality: string }>,
    );
    await vi.advanceTimersByTimeAsync(3399);
    expect(track.state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(track.state.value?.url).toBe('https://cdn/flac');
    expect(track.state.value?.quality).toBe('flac');
    expect(calls).toEqual([
      { name: 'HYWmusic_公益版', quality: 'flac24bit' },
      { name: 'HYWmusic_公益版', quality: 'flac' },
    ]);
    await pending;
  });

  it('在途请求压到 3 个:定稿后排队中的候选不再补发请求', async () => {
    const calls: Array<{ name: string; quality: string }> = [];
    fixture.state.sources = [
      source('s1', '源1'), source('s2', '源2'), source('s3', '源3'),
      source('s4', '源4'), source('s5', '源5'),
    ];
    installRuntime({
      源1: { flac24bit: { delayMs: 1000, url: 'https://cdn/s1' } },
      源2: { flac24bit: { delayMs: 1500, url: 'https://cdn/s2' } },
      源3: { flac24bit: { delayMs: 1500, url: 'https://cdn/s3' } },
    }, calls);
    const backend = await loadBackend();
    const track = tracker();
    const pending = track.watch(
      backend.resolve({ primary: music, qualityPreference: ['flac24bit'] }) as Promise<{ url: string }>,
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(track.state.value?.url).toBe('https://cdn/s1');
    // 源4、源5 分别在 1200ms / 1600ms 尝试取链，被闸门挡在队列里；
    // 1000ms 定稿后队列作废，整首只应该打出 3 个请求。
    expect(calls.map((call) => call.name)).toEqual(['源1', '源2', '源3']);
    await pending;
  });

  it('同轮未胜出的可用结果作为 fallbacks 返回,按音质降序排列', async () => {
    const calls: Array<{ name: string; quality: string }> = [];
    fixture.state.sources = [source('a', '源A'), source('b', '源B')];
    installRuntime({
      源A: {
        flac24bit: { delayMs: 20, error: '无 flac24bit' },
        flac: { delayMs: 200, url: 'https://cdn/a.flac', quality: 'flac' },
      },
      源B: { flac24bit: { delayMs: 500, url: 'https://cdn/b.flac24bit', quality: 'flac24bit' } },
    }, calls);
    const backend = await loadBackend();
    const pending = backend.resolve({
      primary: music,
      qualityPreference: ['flac24bit', 'flac'],
    }) as Promise<{ url: string; quality: string; fallbacks?: Array<{ url: string; quality: string }> }>;
    await vi.advanceTimersByTimeAsync(1400);
    const result = await pending;
    expect(result.url).toBe('https://cdn/b.flac24bit');
    expect(result.quality).toBe('flac24bit');
    expect(result.fallbacks).toEqual([
      expect.objectContaining({ url: 'https://cdn/a.flac', quality: 'flac' }),
    ]);
  });

  it('最高档慢回退(实测 18.7s)不再阻塞降档,可用的 flac 在窗口到期后定稿', async () => {
    const calls: Array<{ name: string; quality: string }> = [];
    installRuntime({ HYWmusic_公益版: {
      flac24bit: { delayMs: 18000, url: 'https://cdn/late24bit', quality: 'flac24bit' },
      flac: { delayMs: 2100, url: 'https://cdn/flac', quality: 'flac' },
    } }, calls);
    const backend = await loadBackend();
    const track = tracker();
    const pending = track.watch(
      backend.resolve({ primary: music, qualityPreference: ['flac24bit', 'flac'] }) as Promise<{ url: string; quality: string }>,
    );
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toEqual([
      { name: 'HYWmusic_公益版', quality: 'flac24bit' },
      { name: 'HYWmusic_公益版', quality: 'flac' },
    ]);
    await vi.advanceTimersByTimeAsync(2899);
    expect(track.state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(track.state.value?.url).toBe('https://cdn/flac');
    expect(track.state.value?.quality).toBe('flac');
    await pending;
  });

  it('快源命中最高档即定稿,后续源零唤醒', async () => {
    const calls: Array<{ name: string; quality: string }> = [];
    fixture.state.sources = [source('main', '主力源'), source('backup', '备用源')];
    installRuntime({ 主力源: { flac24bit: { delayMs: 200, url: 'https://cdn/main', quality: 'flac24bit' } } }, calls);
    const backend = await loadBackend();
    const track = tracker();
    const pending = track.watch(
      backend.resolve({ primary: music, qualityPreference: ['flac24bit'] }) as Promise<{ url: string; quality: string }>,
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(track.state.value?.url).toBe('https://cdn/main');
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual([{ name: '主力源', quality: 'flac24bit' }]);
    await pending;
  });

  it('慢主源在窗口内返回同档结果时优先权归更靠前的源', async () => {
    const calls: Array<{ name: string; quality: string }> = [];
    fixture.state.sources = [source('main', '主力源'), source('backup', '备用源')];
    installRuntime({
      主力源: { flac24bit: { delayMs: 1500, url: 'https://cdn/main', quality: 'flac24bit' } },
      备用源: { flac24bit: { delayMs: 100, url: 'https://cdn/backup', quality: 'flac24bit' } },
    }, calls);
    const backend = await loadBackend();
    const track = tracker();
    const pending = track.watch(
      backend.resolve({ primary: music, qualityPreference: ['flac24bit'] }) as Promise<{ url: string; quality: string }>,
    );
    await vi.advanceTimersByTimeAsync(900);
    expect(track.state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(track.state.value?.url).toBe('https://cdn/main');
    await pending;
    expect(calls.filter((call) => call.name === '备用源').length).toBe(1);
  });

  it('慢主源超出窗口时不无限等待,窗口到期用后源定稿且迟到结果不覆盖', async () => {
    const calls: Array<{ name: string; quality: string }> = [];
    fixture.state.sources = [source('main', '主力源'), source('backup', '备用源')];
    installRuntime({
      主力源: { flac24bit: { delayMs: 3000, url: 'https://cdn/main', quality: 'flac24bit' } },
      备用源: { flac24bit: { delayMs: 100, url: 'https://cdn/backup', quality: 'flac24bit' } },
    }, calls);
    const backend = await loadBackend();
    const track = tracker();
    const pending = track.watch(
      backend.resolve({ primary: music, qualityPreference: ['flac24bit'] }) as Promise<{ url: string; quality: string }>,
    );
    await vi.advanceTimersByTimeAsync(900);
    expect(track.state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(800);
    expect(track.state.value?.url).toBe('https://cdn/backup');
    await vi.advanceTimersByTimeAsync(3000);
    expect(track.state.value?.url).toBe('https://cdn/backup');
    await pending;
  });

  it('占位源快速失败后立即启动下一个源,不空等交错间隔', async () => {
    const calls: Array<{ name: string; quality: string }> = [];
    fixture.state.sources = [source('junk', '占位源'), source('real', '可用源')];
    installRuntime({
      占位源: { flac24bit: { delayMs: 50, error: '需要 apikey' } },
      可用源: { flac24bit: { delayMs: 100, url: 'https://cdn/real', quality: 'flac24bit' } },
    }, calls);
    const backend = await loadBackend();
    const result = await (async () => {
      const pending = backend.resolve({ primary: music, qualityPreference: ['flac24bit'] }) as Promise<{ url: string }>;
      await vi.advanceTimersByTimeAsync(150);
      return pending;
    })();
    expect(result.url).toBe('https://cdn/real');
    expect(calls).toEqual([
      { name: '占位源', quality: 'flac24bit' },
      { name: '可用源', quality: 'flac24bit' },
    ]);
  });

  it('队尾慢源场景(对齐 2026-10 实测):前排源挂死/快败,展开上限保证唯一可用源在预算内定稿', async () => {
    const calls: Array<{ name: string; quality: string }> = [];
    fixture.state.sources = [
      source('hang1', '挂死源'),
      source('fastfail1', '快败源甲'),
      source('hang2', '拒初始化源'),
      source('fastfail2', '快败源乙'),
      source('fastfail3', '快败源丙'),
      source('hyw1', 'HYWmusic甲'),
      source('hyw2', 'HYWmusic乙'),
    ];
    installRuntime({
      挂死源: { flac24bit: { delayMs: 60000 } },
      快败源甲: { flac24bit: { delayMs: 20, error: '后端失败: 所有音质均获取失败' } },
      拒初始化源: { flac24bit: { delayMs: 60000 } },
      快败源乙: { flac24bit: { delayMs: 20, error: '需要 apikey' } },
      快败源丙: { flac24bit: { delayMs: 20, error: 'QQ音乐接口 403' } },
      HYWmusic甲: {
        flac24bit: { delayMs: 60, error: '无 flac24bit' },
        flac: { delayMs: 2000, url: 'https://cdn/hyw1.flac', quality: 'flac' },
      },
      HYWmusic乙: {
        flac24bit: { delayMs: 60, error: '无 flac24bit' },
        flac: { delayMs: 2600, url: 'https://cdn/hyw2.flac', quality: 'flac' },
      },
    }, calls);
    const backend = await loadBackend();
    const track = tracker();
    const pending = track.watch(
      backend.resolve({
        primary: music,
        qualityPreference: ['flac24bit', 'flac', '320k', '192k', '128k'],
      }) as Promise<{ url: string; quality: string }>,
    );
    await vi.advanceTimersByTimeAsync(3400);
    expect(track.state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(track.state.value?.url).toBe('https://cdn/hyw1.flac');
    expect(track.state.value?.quality).toBe('flac');
    await pending;
  });

  it('全部源失败时错误包含每个源名与原因', async () => {
    const calls: Array<{ name: string; quality: string }> = [];
    fixture.state.sources = [source('a', '甲源'), source('b', '乙源')];
    installRuntime({
      甲源: { flac24bit: { delayMs: 30, error: '甲挂了' } },
      乙源: { flac24bit: { delayMs: 30, error: '乙挂了' } },
    }, calls);
    const backend = await loadBackend();
    const track = tracker();
    const pending = track.watch(
      backend.resolve({ primary: music, qualityPreference: ['flac24bit'] }) as Promise<{ url: string; quality: string }>,
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(track.state.settled).toBe(true);
    const message = track.state.error instanceof Error ? track.state.error.message : String(track.state.error);
    expect(message).toContain('所有自定义音源都未解析到可播放链接');
    expect(message).toContain('甲源');
    expect(message).toContain('甲挂了');
    expect(message).toContain('乙源');
    expect(message).toContain('乙挂了');
    await pending.catch(() => undefined);
  });

  it('按脚本声明的 qualitys 预过滤，不把整条降级链都发出去', async () => {
    const calls: Array<{ name: string; quality: string }> = [];
    fixture.state.sources = [
      {
        id: 'flac-only',
        name: '只给无损',
        enabled: true,
        sources: { tx: { type: 'music', actions: ['musicUrl'], qualitys: ['flac'] } },
      } as never,
    ];
    // 只登记 flac；若把 flac24bit/320k 也发出去，runtime 会因「无该档计划」失败，
    // 断言 calls 只有 flac 即可证明预过滤生效。
    installRuntime({ 只给无损: { flac: { delayMs: 50, url: 'https://cdn/flac-only', quality: 'flac' } } }, calls);

    const backend = await loadBackend();
    const track = tracker();
    const pending = track.watch(
      backend.resolve({
        primary: music,
        qualityPreference: ['flac24bit', 'flac', '320k', '192k', '128k'],
      }) as Promise<{ url: string; quality: string }>,
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(calls).toEqual([{ name: '只给无损', quality: 'flac' }]);
    expect(track.state.value?.url).toBe('https://cdn/flac-only');
    await pending;
  });

  it('声明的音质与请求链完全不相交时直接判该源失败，不发请求', async () => {
    const calls: Array<{ name: string; quality: string }> = [];
    fixture.state.sources = [
      {
        id: 'flac-only',
        name: '只给无损',
        enabled: true,
        sources: { tx: { type: 'music', actions: ['musicUrl'], qualitys: ['flac24bit'] } },
      } as never,
    ];
    installRuntime({}, calls);

    const backend = await loadBackend();
    const track = tracker();
    const pending = track.watch(
      backend.resolve({
        primary: music,
        qualityPreference: ['320k', '192k', '128k'],
      }) as Promise<{ url: string; quality: string }>,
    );
    await vi.advanceTimersByTimeAsync(100);

    expect(calls).toEqual([]);
    expect(track.state.settled).toBe(true);
    const message = track.state.error instanceof Error ? track.state.error.message : String(track.state.error);
    expect(message).toContain('未声明支持');
    await pending.catch(() => undefined);
  });
});
