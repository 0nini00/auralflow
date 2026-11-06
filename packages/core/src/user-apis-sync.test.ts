import { expect, it } from 'vitest';
import { buildUserApisSyncFile, parseUserApisSyncFile } from './user-apis-sync';

it('音源文件只写共享元数据和非空脚本，保留调用方提供的时间', () => {
  const source = { id: 'one', name: 'Source', description: 'Description', script: '// script', enabled: false, allowShowUpdateAlert: false };
  expect(buildUserApisSyncFile([source, { id: 'empty', script: '  ' }], 123)).toEqual({
    version: '2', lastModified: 123,
    data: [{ id: 'one', name: 'Source', description: 'Description', script: '// script', author: '', homepage: '', version: '', allowShowUpdateAlert: false }],
  });
  expect(source.enabled).toBe(false);
});

it('数组与脚本表两种格式交给平台转换，按输入顺序保留有效结果', async () => {
  const apis = [{ id: 'first', script: '// inline' }, { id: 'skip' }, { id: 'last' }];
  const calls: unknown[] = [];
  const convert = async (api: { id?: unknown; script?: unknown }, scripts: Record<string, string>, index: number) => {
    calls.push([api, scripts, index]);
    return api.id === 'skip' ? null : { id: api.id, script: api.script ?? scripts[String(api.id)] };
  };
  expect(await parseUserApisSyncFile(JSON.stringify({ data: { list: apis, scripts: { last: 'gz_encoded' } } }), convert))
    .toEqual([{ id: 'first', script: '// inline' }, { id: 'last', script: 'gz_encoded' }]);
  expect(calls).toEqual(apis.map((api, index) => [api, { last: 'gz_encoded' }, index]));
  expect(await parseUserApisSyncFile(JSON.stringify({ data: [apis[0]] }), convert)).toEqual([{ id: 'first', script: '// inline' }]);
});

it('损坏文件明确失败，平台解压或转换异常原样向上传递', async () => {
  const convert = async () => ({ id: 'unused' });
  for (const text of ['{', 'null', '[]', '{"data":1}', '{"data":{"list":{}}}', '{"data":[null]}', '{"data":{"scripts":{"id":1}}}']) {
    await expect(parseUserApisSyncFile(text, convert)).rejects.toThrow('云端音源文件已损坏或不是有效的 JSON');
  }
  const error = new Error('inflate failed');
  await expect(parseUserApisSyncFile('{"data":[{}]}', async () => { throw error; })).rejects.toBe(error);
  expect(await parseUserApisSyncFile('{}', convert)).toEqual([]);
});
