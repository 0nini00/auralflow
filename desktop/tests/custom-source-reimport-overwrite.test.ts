import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 用户反馈:更新音源时导入新脚本不会覆盖旧源,得手动删。
 * 根因是 importScript 只按「脚本内容完全相同」查重,同名的新脚本会被当成另一个源追加。
 */
const fixture = vi.hoisted(() => ({
  saved: null as Record<string, unknown> | null,
  name: '测试源',
  invalidate: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: vi.fn() }));
vi.mock('../src/services/customSourceRuntime', () => ({
  // 真实实现里 name 来自脚本头部注释,加载时也会按脚本重算;
  // mock 必须同样由脚本推导,否则「同名/不同名」两种情况区分不出来。
  parseDesktopUserApiInfo: (script: string) => ({
    name: script.includes('another') ? '另一个源' : '测试源',
    description: `来自 ${script}`,
    author: '作者',
    homepage: 'https://example.com',
    version: script.includes('v2') ? '2.0.0' : '1.0.0',
  }),
  invalidateRuntimeCache: fixture.invalidate,
  invalidateAllRuntimeCaches: vi.fn(),
}));
vi.mock('../src/stores/libraryPersistence', () => ({
  attachLibraryPersistence: (store: { setState: (value: unknown) => void }, options: {
    pick: (state: unknown) => Record<string, unknown>;
    apply: (slice: unknown, set: (value: unknown) => void) => void;
  }) => {
    if (fixture.saved) options.apply(fixture.saved, store.setState);
    return { ready: Promise.resolve(), loadError: null, flush: vi.fn() };
  },
}));

const oldSource = {
  id: 'existing-id',
  name: '测试源',
  description: '旧描述',
  script: '// old script v1',
  enabled: false,
  allowShowUpdateAlert: false,
  author: '旧作者',
  homepage: 'https://old.example.com',
  version: '1.0.0',
  sources: { wy: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } },
  testStatus: 'ok',
  testMessage: '初始化正常',
  updateStatus: 'available',
  updateMessage: '发现更新',
  updateLog: '旧日志',
  updateUrl: 'https://old.example.com/api',
  updateCheckedAt: 123,
  createdAt: 1,
  updatedAt: 1,
};

async function load() {
  const module = await import('../src/stores/customSourceStore');
  await module.customSourcePersistence.ready;
  return module;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  fixture.saved = null;
  fixture.name = '测试源';
});

describe('导入同名音源时原位覆盖', () => {
  it('同名新脚本替换旧源,不追加第二份', async () => {
    fixture.saved = { featureEnabled: true, sources: [oldSource] };
    const { useCustomSourceStore } = await load();

    await useCustomSourceStore.getState().importScript('// new script v2 longer');

    const sources = useCustomSourceStore.getState().sources;
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe('existing-id');
    expect(sources[0].script).toBe('// new script v2 longer');
    expect(sources[0].version).toBe('2.0.0');
    expect(sources[0].description).toContain('new script v2 longer');
  });

  it('保留用户的启用状态与更新提醒开关', async () => {
    fixture.saved = { featureEnabled: true, sources: [oldSource] };
    const { useCustomSourceStore } = await load();

    const result = await useCustomSourceStore.getState().importScript('// new script');

    expect(result.enabled).toBe(false);
    expect(result.allowShowUpdateAlert).toBe(false);
    expect(result.createdAt).toBe(1);
  });

  it('清掉旧脚本的能力清单与更新状态,等待重新测试', async () => {
    fixture.saved = { featureEnabled: true, sources: [oldSource] };
    const { useCustomSourceStore } = await load();

    const result = await useCustomSourceStore.getState().importScript('// new script');

    expect(result.sources).toBeUndefined();
    expect(result.testStatus).toBe('idle');
    expect(result.testMessage).toBeUndefined();
    expect(result.updateStatus).toBe('idle');
    expect(result.updateMessage).toBeUndefined();
    expect(result.updateLog).toBeUndefined();
    expect(result.updateUrl).toBeUndefined();
    expect(result.updateCheckedAt).toBeUndefined();
  });

  it('覆盖时失效该源的运行时缓存', async () => {
    fixture.saved = { featureEnabled: true, sources: [oldSource] };
    const { useCustomSourceStore } = await load();

    await useCustomSourceStore.getState().importScript('// new script');

    expect(fixture.invalidate).toHaveBeenCalledWith('existing-id');
  });

  it('脚本内容完全相同时仍拒绝导入', async () => {
    fixture.saved = { featureEnabled: true, sources: [oldSource] };
    const { useCustomSourceStore } = await load();

    await expect(useCustomSourceStore.getState().importScript('// old script v1')).rejects.toThrow('相同');
    expect(useCustomSourceStore.getState().sources).toHaveLength(1);
  });

  it('不同名的音源仍然新增一份', async () => {
    fixture.saved = { featureEnabled: true, sources: [oldSource] };
    fixture.name = '另一个源';
    const { useCustomSourceStore } = await load();

    await useCustomSourceStore.getState().importScript('// another script');

    const sources = useCustomSourceStore.getState().sources;
    expect(sources).toHaveLength(2);
    expect(sources[1].name).toBe('另一个源');
  });
});