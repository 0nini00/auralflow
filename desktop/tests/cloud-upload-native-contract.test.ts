import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TAURI_EVENTS } from '@lx/tauri-bridge';

const root = resolve(__dirname, '..');
const rust = readFileSync(resolve(root, 'src-tauri/src/commands/cloud_upload.rs'), 'utf8');
const main = readFileSync(resolve(root, 'src-tauri/src/main.rs'), 'utf8');
const bridge = readFileSync(resolve(root, 'packages/tauri-bridge/src/index.ts'), 'utf8');

describe('云盘上传原生契约', () => {
  it('Rust 命令已注册，桥接函数调用真实命令名', () => {
    for (const command of ['cloud_upload_lbs', 'cloud_file_md5', 'cloud_upload_file', 'cancel_cloud_upload']) {
      expect(main).toContain(`commands::${command}`);
      expect(bridge).toContain(`"${command}"`);
    }
  });

  it('上传进度事件名两端一致，载荷字段按 camelCase 序列化', () => {
    expect(TAURI_EVENTS.cloudUploadProgress).toBe('cloud-upload-progress');
    expect(rust).toContain(`"${TAURI_EVENTS.cloudUploadProgress}"`);
    const event = rust.slice(rust.indexOf('struct CloudUploadProgressEvent'), rust.indexOf('struct LbsResponse'));
    for (const field of ['task_id', 'uploaded', 'total', 'progress']) {
      expect(event).toContain(field);
    }
  });

  it('直传带 NOS 凭证与 MD5，并使用有长度的流式请求体', () => {
    expect(rust).toContain('"x-nos-token"');
    expect(rust).toContain('"Content-MD5"');
    expect(rust).toContain('Body::sized(reader, file_size)');
    expect(rust).toContain('Policy::none()');
  });
});
