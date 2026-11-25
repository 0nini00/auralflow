import { beforeEach, describe, expect, it, vi } from 'vitest';

const MD5 = '0123456789abcdef0123456789abcdef';
const COOKIE = 'MUSIC_U=FAKE; __csrf=FAKE_CSRF';

const api = vi.hoisted(() => ({
  open: vi.fn(),
  getAudioInfo: vi.fn(),
  cloudFileMd5: vi.fn(),
  cloudUploadLbs: vi.fn(),
  cloudUploadFile: vi.fn(),
  weapi: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: api.open }));
vi.mock('@lx/tauri-bridge', () => ({
  getAudioInfo: api.getAudioInfo,
  cloudFileMd5: api.cloudFileMd5,
  cloudUploadLbs: api.cloudUploadLbs,
  cloudUploadFile: api.cloudUploadFile,
}));
vi.mock('@/services/wyAccountService', () => ({
  getWyCookie: async () => COOKIE,
}));
vi.mock('@/services/wyRequest', () => ({
  sendWyWeapi: (...args: unknown[]) => api.weapi(...args),
  assertWyOk: (body: { code?: number; message?: string }) => {
    if (body.code !== 200) throw new Error(body.message || `code=${body.code}`);
  },
}));

const { deleteCloudSong, pickCloudAudioFiles, uploadCloudAudio } =
  await import('../src/services/cloudUploadService');

const file = {
  path: 'C:\\Music\\晴天.flac',
  fileName: '晴天.flac',
  size: 55_397_039,
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  mimeType: 'audio/flac',
};

function responses(needUpload = true) {
  return [
    { code: 200, needUpload, songId: '9001' },
    { code: 200, result: { token: 'nos-token', objectKey: 'dir/file.flac', resourceId: 'resource-1' } },
    { code: 200, songId: '9001' },
    { code: 200 },
  ];
}

function callbacks() {
  const phases: string[] = [];
  return {
    phases,
    value: {
      taskId: 'upload-1',
      onPhase: (phase: string) => phases.push(phase),
      isCancelled: () => false,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.cloudFileMd5.mockResolvedValue({ md5: MD5, size: file.size });
  api.cloudUploadLbs.mockResolvedValue('https://nos.example/upload/');
  api.cloudUploadFile.mockResolvedValue(undefined);
  api.getAudioInfo.mockResolvedValue({
    id: '1', path: file.path, title: file.title, artist: file.artist,
    album: file.album, duration: 269, format: 'flac', size: file.size,
  });
});

describe('桌面云盘上传', () => {
  it('按 check、token、LBS、Rust 直传、入库、发布顺序执行', async () => {
    const queue = responses(true);
    api.weapi.mockImplementation(async () => queue.shift());
    const c = callbacks();

    const outcome = await uploadCloudAudio(file, c.value);

    expect(api.weapi.mock.calls.map((call) => call[0])).toEqual([
      '/cloud/upload/check',
      '/nos/token/alloc',
      '/upload/cloud/info/v2',
      '/cloud/pub/v2',
    ]);
    expect(api.weapi.mock.calls[0][1]).toMatchObject({
      bitrate: '999000', ext: '', length: file.size, md5: MD5, songId: '0', version: 1,
    });
    expect(api.weapi.mock.calls[1][1]).toMatchObject({
      bucket: 'jd-musicrep-privatecloud-audio-public',
      ext: 'flac', filename: '晴天', md5: MD5, nos_product: 3, type: 'audio',
    });
    expect(api.weapi.mock.calls[2][1]).toMatchObject({
      filename: '晴天.flac', song: '晴天', artist: '周杰伦', album: '叶惠美', songid: '9001', resourceId: 'resource-1',
    });
    expect(api.weapi.mock.calls[3][1]).toEqual({ songid: '9001' });
    expect(api.weapi.mock.calls.every((call) => call[2] === `${COOKIE}; os=pc`)).toBe(true);

    expect(api.cloudUploadFile).toHaveBeenCalledWith(
      'upload-1',
      file.path,
      'https://nos.example/upload/jd-musicrep-privatecloud-audio-public/dir%2Ffile.flac?offset=0&complete=true&version=1.0',
      'nos-token',
      MD5,
      'audio/flac',
      file.size,
    );
    expect(c.phases).toEqual(['hashing', 'checking', 'uploading', 'completing']);
    expect(outcome).toEqual({ songId: '9001', needUpload: true });
  });

  it('needUpload=false 时跳过二进制上传', async () => {
    const queue = responses(false);
    api.weapi.mockImplementation(async () => queue.shift());
    const c = callbacks();

    const outcome = await uploadCloudAudio(file, c.value);

    expect(api.cloudUploadFile).not.toHaveBeenCalled();
    expect(api.cloudUploadLbs).not.toHaveBeenCalled();
    expect(c.phases).toEqual(['hashing', 'checking', 'completing']);
    expect(outcome).toEqual({ songId: '9001', needUpload: false });
  });

  it('取消后不再发起 weapi 请求', async () => {
    const c = callbacks();
    await expect(uploadCloudAudio(file, { ...c.value, isCancelled: () => true }))
      .rejects.toMatchObject({ name: 'CloudUploadCancelledError' });
    expect(api.weapi).not.toHaveBeenCalled();
  });

  it('删除使用 songIds 数组', async () => {
    api.weapi.mockResolvedValue({ code: 200 });
    await deleteCloudSong('9001');
    expect(api.weapi).toHaveBeenCalledWith('/cloud/del', { songIds: ['9001'] }, `${COOKIE}; os=pc`);
  });

  it('文件选择读取标签并映射 MIME', async () => {
    api.open.mockResolvedValue([file.path]);
    const picked = await pickCloudAudioFiles();
    expect(picked).toEqual([file]);
    expect(api.getAudioInfo).toHaveBeenCalledWith(file.path);
  });
});
