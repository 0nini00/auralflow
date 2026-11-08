export const IMMERSIVE_BACKGROUND_OPTIONS = [
  { value: "none", label: "纯色" },
  { value: "cover", label: "封面氛围" },
  { value: "liquid", label: "液态渐变" },
  { value: "aurora", label: "极光光幕" },
] as const;

export type ImmersiveBackgroundMode = typeof IMMERSIVE_BACKGROUND_OPTIONS[number]["value"];

export const DEFAULT_IMMERSIVE_BACKGROUND: ImmersiveBackgroundMode = "cover";

export function isImmersiveBackgroundMode(value: unknown): value is ImmersiveBackgroundMode {
  return IMMERSIVE_BACKGROUND_OPTIONS.some((option) => option.value === value);
}

/** 仅用于读取旧存档：缺少新字段时迁移旧开关，损坏的新值使用既有默认背景。 */
export function normalizeImmersiveBackground(
  value: unknown,
  legacyAmbientCoverTint?: unknown,
): ImmersiveBackgroundMode {
  if (isImmersiveBackgroundMode(value)) return value;
  if (value === undefined && legacyAmbientCoverTint === false) return "none";
  return DEFAULT_IMMERSIVE_BACKGROUND;
}
