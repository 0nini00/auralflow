export type LyricAnimationIntensity = "reduced" | "normal" | "enhanced";

const INTENSITY_SET = new Set<LyricAnimationIntensity>(["reduced", "normal", "enhanced"]);

export function normalizeLyricAnimationIntensity(value: unknown): LyricAnimationIntensity {
  return typeof value === "string" && INTENSITY_SET.has(value as LyricAnimationIntensity)
    ? value as LyricAnimationIntensity
    : "normal";
}

export function getLyricAnimationIntensityScale(value: unknown): number {
  switch (normalizeLyricAnimationIntensity(value)) {
    case "reduced":
      return 0.55;
    case "enhanced":
      return 1.25;
    case "normal":
    default:
      return 1;
  }
}
