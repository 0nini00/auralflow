import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong } from '../src/services/localMusicService';

/**
 * 「选择歌词」面板的三条动作与失败处理。
 *
 * 这里只测面板自己的契约：候选全部摆出来（含标注与预览）、点选写 picked 与来源标注、
 * 「不要匹配」写 local-only、「恢复自动匹配」写 auto；搜索失败只显示错误与「重试」，
 * 绝不改写用户当前的 mode。取候选 / 算指纹 / 落库都在服务层，已在别的用例里覆盖，这里替换掉。
 */

const deps = vi.hoisted(() => ({
  listLocalLyricCandidates: vi.fn(),
  fetchLyricsCandidateLines: vi.fn(),
  formatLyricsAsLrc: vi.fn(),
  applyLocalLyricsChoice: vi.fn(),
  computeLocalLyricsFingerprint: vi.fn(),
}));

vi.mock('@/services/lyricsService', () => ({
  listLocalLyricCandidates: deps.listLocalLyricCandidates,
  fetchLyricsCandidateLines: deps.fetchLyricsCandidateLines,
  formatLyricsAsLrc: deps.formatLyricsAsLrc,
}));
vi.mock('@/services/localLyricsChoiceService', () => ({
  applyLocalLyricsChoice: deps.applyLocalLyricsChoice,
  computeLocalLyricsFingerprint: deps.computeLocalLyricsFingerprint,
}));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ scanDirectory: vi.fn(), getAudioInfo: vi.fn(), hashLocalFile: vi.fn() }));

import { LyricsChoiceDialog } from '../src/components/LyricsChoiceDialog';

const song: LocalSong = {
  id: 'local-a', path: 'F:\\music\\a.flac', title: '日', artist: '吴亦凡', album: '专辑',
  duration: 200, format: 'flac', size: 4096, isLocal: true,
};

const localCandidate = {
  key: 'local', kind: 'local' as const, sourceLabel: '本地文件',
  name: '日', singer: '吴亦凡', albumName: '专辑', preview: '文件里的词',
};
const neteaseCandidate = {
  key: 'wy:9', kind: 'wy' as const, sourceLabel: '网易云',
  name: '日', singer: '湘伦', albumName: '翻唱集', durationDeltaSeconds: 12.5,
  tier: 'other-performer' as const, preview: '别人的词', neteaseId: '9',
};

let renderer: ReactTestRenderer;
const onClose = vi.fn();
const root = () => renderer.root;
const text = () => JSON.stringify(renderer.toJSON());
const button = (label: string) => root().findByProps({ 'aria-label': label });

async function mount() {
  await act(async () => { renderer = create(<LyricsChoiceDialog song={song} onClose={onClose} />); });
}

beforeEach(() => {
  vi.clearAllMocks();
  deps.listLocalLyricCandidates.mockResolvedValue({ candidates: [localCandidate, neteaseCandidate] });
  deps.fetchLyricsCandidateLines.mockResolvedValue([{ time: 1, text: '别人的词' }]);
  deps.formatLyricsAsLrc.mockReturnValue('[00:01.000]别人的词');
  deps.computeLocalLyricsFingerprint.mockResolvedValue('4096:abc');
});
afterEach(() => { act(() => renderer?.unmount()); });

describe('候选列表与动作', () => {
  it('候选全部列出，带来源、档位、时长差与首行预览，并显示当前状态', async () => {
    await mount();

    expect(text()).toContain('本地文件');
    expect(text()).toContain('网易云');
    expect(text()).toContain('同曲异唱档');
    expect(text()).toContain('时长差 12.5s');
    expect(text()).toContain('首行：别人的词');
    // 标题与状态是两个文本节点，分开断言
    expect(text()).toContain('· 当前：');
    expect(text()).toContain('自动匹配');
  });

  it('点某一条 → picked：现算一次指纹，写文本与来源标注，然后关闭面板', async () => {
    await mount();

    await act(async () => { button('使用网易云的歌词：日').props.onClick(); });

    expect(deps.computeLocalLyricsFingerprint).toHaveBeenCalledTimes(1);
    expect(deps.applyLocalLyricsChoice).toHaveBeenCalledWith(song, {
      type: 'picked', fingerprint: '4096:abc', sourceLabel: '网易云', text: '[00:01.000]别人的词',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('候选取不到词时什么都不改，并提示换一条', async () => {
    deps.fetchLyricsCandidateLines.mockResolvedValue([]);
    deps.formatLyricsAsLrc.mockReturnValue('');
    await mount();

    await act(async () => { button('使用网易云的歌词：日').props.onClick(); });

    expect(deps.applyLocalLyricsChoice).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(text()).toContain('没能取到歌词');
  });

  it('「不要匹配」→ local-only（不联网的那一档）', async () => {
    await mount();

    await act(async () => { button('不要匹配，只用本地歌词').props.onClick(); });

    expect(deps.applyLocalLyricsChoice).toHaveBeenCalledWith(song, { type: 'local-only', fingerprint: '4096:abc' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('「恢复自动匹配」→ auto，且不必算指纹', async () => {
    await mount();

    await act(async () => { button('恢复自动匹配').props.onClick(); });

    expect(deps.applyLocalLyricsChoice).toHaveBeenCalledWith(song, { type: 'auto' });
    expect(deps.computeLocalLyricsFingerprint).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('候选搜索失败', () => {
  it('显示错误与「重试」，且不改动当前选择', async () => {
    deps.listLocalLyricCandidates.mockResolvedValue({
      candidates: [localCandidate], error: '平台搜索失败：HTTP 500',
    });
    await mount();

    expect(text()).toContain('平台搜索失败：HTTP 500');
    expect(text()).toContain('本地文件');
    expect(text()).toContain('当前选择没有被改动');
    expect(deps.applyLocalLyricsChoice).not.toHaveBeenCalled();

    await act(async () => { button('重试').props.onClick(); });
    expect(deps.listLocalLyricCandidates).toHaveBeenCalledTimes(2);
  });

  it('整次取候选抛错时同样只显示错误，不写记录', async () => {
    deps.listLocalLyricCandidates.mockRejectedValue(new Error('离线'));
    await mount();

    expect(text()).toContain('离线');
    expect(deps.applyLocalLyricsChoice).not.toHaveBeenCalled();
  });
});
