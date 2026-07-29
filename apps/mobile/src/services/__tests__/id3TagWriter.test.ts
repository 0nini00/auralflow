import { describe, expect, it } from "vitest";

import {
  buildId3Tag,
  embedId3Tag,
  stripExistingId3,
  type Id3Cover,
} from "@/services/id3TagWriter";

function toAscii(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return s;
}

describe("id3TagWriter", () => {
  it("builds a valid ID3v2.4 header", () => {
    const tag = buildId3Tag({ title: "Song", artist: "Artist", album: "Album" });
    expect(tag[0]).toBe(0x49); // I
    expect(tag[1]).toBe(0x44); // D
    expect(tag[2]).toBe(0x33); // 3
    expect(tag[3]).toBe(0x04); // version 2.4
  });

  it("embeds text frames TIT2/TPE1/TALB", () => {
    const tag = buildId3Tag({ title: "Song", artist: "Artist", album: "Album" });
    const text = toAscii(tag);
    expect(text).toContain("TIT2");
    expect(text).toContain("TPE1");
    expect(text).toContain("TALB");
    expect(text).toContain("Song");
    expect(text).toContain("Artist");
    expect(text).toContain("Album");
  });

  it("encodes UTF-8 text (CJK) correctly", () => {
    const tag = buildId3Tag({ title: "歌名" });
    const decoded = new TextDecoder("utf-8").decode(tag);
    expect(decoded).toContain("歌名");
  });

  it("embeds APIC cover with mime", () => {
    const cover: Id3Cover = {
      mime: "image/jpeg",
      data: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
    };
    const tag = buildId3Tag({ cover });
    const text = toAscii(tag);
    expect(text).toContain("APIC");
    expect(text).toContain("image/jpeg");
  });

  it("embeds USLT lyrics", () => {
    const tag = buildId3Tag({ lyrics: "[00:01.00]hello" });
    const text = toAscii(tag);
    expect(text).toContain("USLT");
    expect(text).toContain("hello");
  });

  it("strips an existing ID3v2 header before embedding", () => {
    const oldTag = buildId3Tag({ title: "old" });
    const audio = new Uint8Array([1, 2, 3, 4, 5]);
    const combined = new Uint8Array(oldTag.length + audio.length);
    combined.set(oldTag, 0);
    combined.set(audio, oldTag.length);

    const stripped = stripExistingId3(combined);
    expect(stripped.length).toBe(audio.length);
    expect(stripped[0]).toBe(1);

    const reEmbedded = embedId3Tag(combined, { title: "new" });
    const strippedAgain = stripExistingId3(reEmbedded);
    expect(toAscii(strippedAgain)).not.toContain("old");
    expect(toAscii(strippedAgain)).toContain(String.fromCharCode(1));
  });

  it("skips empty frames (only 10-byte header)", () => {
    const tag = buildId3Tag({});
    expect(tag.length).toBe(10);
  });
});
