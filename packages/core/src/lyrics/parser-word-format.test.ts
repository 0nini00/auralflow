import { describe, expect, it } from "vitest";
import { detectLyricSourceType, parseLyricSource } from "./parser";

/** qrc 明文（两参括号标记）经 auto 判型后必须能完整解析。
 *
 *  历史缺陷：判型把两参/三参括号标记都判成 yrc，而 parseYrc 只认三参标记，
 *  qrc 明文整首静默解析为空（用户视角：这首歌突然「没有歌词」）。
 */
describe("qrc 明文经 auto 判型解析", () => {
  const qrc = [
    "[12345,6780](12345,300)我(12645,680)爱(13325,900)你呀",
    "[19125,540](19125,540)第二行",
  ].join("\n");

  it("判型结果可被解析（yrc 宽容正则同时覆盖两参标记）", () => {
    expect(detectLyricSourceType(qrc)).toBe("yrc");
    const lines = parseLyricSource({ type: "auto", content: qrc });
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe("我爱你呀");
    expect(lines[0].words?.map((word) => word.text)).toEqual(["我", "爱", "你呀"]);
    expect(lines[0].words?.[0].start).toBeCloseTo(12.345, 3);
    expect(lines[1].text).toBe("第二行");
  });

  it("三参标记的 yrc 解析不受影响", () => {
    const yrc = "[1000,2000](1000,500,0)你(1500,500,0)好";
    const lines = parseLyricSource({ type: "auto", content: yrc });
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("你好");
    expect(lines[0].words?.map((word) => word.text)).toEqual(["你", "好"]);
  });

  it("显式 qrc 类型走原解析分支", () => {
    const lines = parseLyricSource({ type: "qrc", content: "[1000,1000](1000,1000)词" });
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("词");
  });
});
