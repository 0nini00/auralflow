/**
 * 纯 JS ID3v2.4 标签写入器（无原生依赖，RN/Hermes 可用）。
 *
 * 设计目标：对齐桌面端 `@lx/tauri-bridge` 的 setAudioMetadata / setAudioCover /
 * setAudioLyrics，但移动端无法使用 Tauri 原生桥，也没有任何 ID3 库，因此这里用
 * Uint8Array 手写 ID3v2.4 帧，配合 react-native-fs 的 base64 读写完成嵌入。
 *
 * 全部函数只操作字节，不依赖 RN，因此可直接在 Node 环境下单测。
 */

export interface Id3Cover {
  /** MIME，如 "image/jpeg" / "image/png" */
  mime: string;
  data: Uint8Array;
}

export interface Id3TagInput {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  genre?: string;
  cover?: Id3Cover;
  lyrics?: string;
}

/** 手写 UTF-8 编码，避免依赖 TextEncoder（Hermes 不一定有）。 */
function utf8Bytes(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i += 1) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const hi = code;
      const lo = str.charCodeAt(i + 1);
      code = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
      i += 1;
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      out.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

/** 28 位 syncsafe 整数（ID3 size 字段用，每字节最高位必须为 0）。 */
function syncsafe(value: number): Uint8Array {
  return new Uint8Array([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ]);
}

class ByteBuilder {
  private chunks: Uint8Array[] = [];
  private length = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  pushStr(str: string): void {
    this.push(utf8Bytes(str));
  }

  pushByte(b: number): void {
    this.push(new Uint8Array([b]));
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

function frame(id: string, body: Uint8Array): Uint8Array {
  const header = new ByteBuilder();
  header.pushStr(id);
  header.push(syncsafe(body.length));
  header.pushByte(0x00); // flags (2 字节)
  header.pushByte(0x00);
  header.push(body);
  return header.toUint8Array();
}

/** 文本帧：ID3v2.4 编码字节 0x03 = UTF-8。 */
function textFrame(frameId: string, text: string): Uint8Array {
  const body = new ByteBuilder();
  body.pushByte(0x03);
  body.pushStr(text);
  return frame(frameId, body.toUint8Array());
}

/** 附图帧 APIC：编码 / MIME / 图片类型(0x03=封面) / 描述(空) / 图片数据。 */
function apicFrame(cover: Id3Cover): Uint8Array {
  const body = new ByteBuilder();
  body.pushByte(0x03);
  body.pushStr(cover.mime);
  body.pushByte(0x00);
  body.pushByte(0x03);
  body.pushStr("");
  body.pushByte(0x00);
  body.push(cover.data);
  return frame("APIC", body.toUint8Array());
}

/** 非同步歌词帧 USLT：编码 / 语言(eng) / 描述(空) / 歌词文本。 */
function usltFrame(lyrics: string): Uint8Array {
  const body = new ByteBuilder();
  body.pushByte(0x03);
  body.pushStr("eng");
  body.pushStr("");
  body.pushByte(0x00);
  body.pushStr(lyrics);
  return frame("USLT", body.toUint8Array());
}

/** 构造完整 ID3v2.4 标签（含 10 字节文件头）。 */
export function buildId3Tag(input: Id3TagInput): Uint8Array {
  const frames = new ByteBuilder();
  if (input.title) frames.push(textFrame("TIT2", input.title));
  if (input.artist) frames.push(textFrame("TPE1", input.artist));
  if (input.album) frames.push(textFrame("TALB", input.album));
  if (input.year) frames.push(textFrame("TYER", input.year));
  if (input.genre) frames.push(textFrame("TCON", input.genre));
  if (input.cover && input.cover.data.length > 0) {
    frames.push(apicFrame(input.cover));
  }
  if (input.lyrics && input.lyrics.trim()) frames.push(usltFrame(input.lyrics));

  const framesBytes = frames.toUint8Array();
  const header = new ByteBuilder();
  header.pushStr("ID3");
  header.pushByte(0x04); // 主版本 2.4
  header.pushByte(0x00); // 次版本
  header.pushByte(0x00); // flags
  header.push(syncsafe(framesBytes.length));
  header.push(framesBytes);
  return header.toUint8Array();
}

/** 剥离音频文件已有的 ID3v2 头（若没有则原样返回）。 */
export function stripExistingId3(audio: Uint8Array): Uint8Array {
  const hasId3 =
    audio.length >= 10 &&
    audio[0] === 0x49 &&
    audio[1] === 0x44 &&
    audio[2] === 0x33;
  if (!hasId3) return audio;
  const size =
    ((audio[6] & 0x7f) << 21) |
    ((audio[7] & 0x7f) << 14) |
    ((audio[8] & 0x7f) << 7) |
    (audio[9] & 0x7f);
  const start = 10 + size;
  return start <= audio.length ? audio.slice(start) : audio;
}

/** 在音频数据前嵌入 ID3v2 标签（先剥离旧标签，避免叠加）。无任何内容时原样返回。 */
export function embedId3Tag(audio: Uint8Array, input: Id3TagInput): Uint8Array {
  const tag = buildId3Tag(input);
  if (tag.length <= 10) return audio; // 只有空文件头，无需写入
  const body = stripExistingId3(audio);
  const out = new Uint8Array(tag.length + body.length);
  out.set(tag, 0);
  out.set(body, tag.length);
  return out;
}
