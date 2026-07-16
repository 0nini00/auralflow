import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as controlsModel from "@/services/immersiveControlsModel";

const { buildImmersiveControlsVisibilityModel } = controlsModel;

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function readStyleBlock(source: string, styleName: string): string {
  const match = source.match(new RegExp(`${styleName}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`));
  expect(match, `missing ${styleName} style`).not.toBeNull();
  return match?.[1] ?? "";
}

function readNumericStyleValue(block: string, property: string): number {
  const match = block.match(new RegExp(`${property}:\\s*(\\d+)`));
  expect(match, `missing numeric ${property}`).not.toBeNull();
  return Number(match?.[1]);
}

describe("immersive controls model", () => {
  it("builds explicit hide and restore controls for immersive lyrics", () => {
    expect(buildImmersiveControlsVisibilityModel(true)).toEqual({
      controlsVisible: true,
      hidden: false,
      actionLabel: "隐藏控制栏",
      restoreLabel: "显示控制栏",
      nextControlsVisible: false,
    });

    expect(buildImmersiveControlsVisibilityModel(false)).toEqual({
      controlsVisible: false,
      hidden: true,
      actionLabel: "显示控制栏",
      restoreLabel: "显示控制栏",
      nextControlsVisible: true,
    });
  });

  it("maps a measured poster-wave press to a finite clamped seek time", () => {
    const getPosterWaveSeekTime = (
      controlsModel as typeof controlsModel & {
        getPosterWaveSeekTime?: (locationX: number, width: number, duration: number) => number | null;
      }
    ).getPosterWaveSeekTime;

    expect(getPosterWaveSeekTime).toBeTypeOf("function");
    if (!getPosterWaveSeekTime) return;

    expect(getPosterWaveSeekTime(50, 200, 400)).toBe(100);
    expect(getPosterWaveSeekTime(-20, 200, 400)).toBe(0);
    expect(getPosterWaveSeekTime(240, 200, 400)).toBe(400);
    expect(getPosterWaveSeekTime(Number.NaN, 200, 400)).toBeNull();
    expect(getPosterWaveSeekTime(50, Number.POSITIVE_INFINITY, 400)).toBeNull();
    expect(getPosterWaveSeekTime(50, 0, 400)).toBeNull();
    expect(getPosterWaveSeekTime(50, 200, Number.NaN)).toBeNull();
    expect(getPosterWaveSeekTime(50, 200, 0)).toBeNull();
  });

  it("binds the visible poster wave to the measured accessible seek control", () => {
    const posterSource = readSource("src/screens/immersive/PosterMode.tsx");
    const stylesSource = readSource("src/screens/immersive/immersiveStyles.ts");
    const waveStyle = readStyleBlock(stylesSource, "posterWaveArea");

    expect(posterSource).toContain("getPosterWaveSeekTime");
    expect(posterSource).toMatch(
      /controlsHidden[\s\S]*<Pressable[\s\S]*style=\{styles\.posterWaveArea\}[\s\S]*<PosterWaveVisualizer/,
    );
    expect(posterSource).toContain("event.nativeEvent.layout.width");
    expect(posterSource).toContain("event.nativeEvent.locationX");
    expect(posterSource).toContain("event.stopPropagation()");
    expect(posterSource).toContain('accessibilityRole="adjustable"');
    expect(posterSource).toContain('accessibilityLabel="播放进度"');
    expect(posterSource).toContain("accessibilityValue={{");
    expect(waveStyle).toContain("minHeight: touch.minTarget");
  });

  it("fits all five declared main controls within a 320px viewport", () => {
    const stylesSource = readSource("src/screens/immersive/immersiveStyles.ts");
    const bottomBar = readStyleBlock(stylesSource, "bottomBar");
    const mainControls = readStyleBlock(stylesSource, "mainControls");
    const modeControlButton = readStyleBlock(stylesSource, "modeControlButton");
    const controlButton = readStyleBlock(stylesSource, "controlButton");
    const playButton = readStyleBlock(stylesSource, "playButton");

    const horizontalPadding = readNumericStyleValue(bottomBar, "paddingHorizontal");
    const declaredGap = mainControls.match(/gap:\s*(\d+)/)?.[1];
    const minimumViewportWidth =
      horizontalPadding * 2
      + readNumericStyleValue(modeControlButton, "width") * 2
      + readNumericStyleValue(controlButton, "width") * 2
      + readNumericStyleValue(playButton, "width")
      + Number(declaredGap ?? 0) * 4;

    expect(minimumViewportWidth).toBeLessThanOrEqual(320);
    expect(mainControls).toContain('width: "100%"');
    expect(mainControls).toContain('justifyContent: "space-between"');
  });
});
