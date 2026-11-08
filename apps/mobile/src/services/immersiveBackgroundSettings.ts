export const IMMERSIVE_BACKGROUND_OPTIONS = [
  { value: "none", label: "纯色" },
  { value: "cover", label: "封面氛围" },
  { value: "bloom", label: "柔光色域" },
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
  // 旧的两种动态背景已合并为柔光色域，存量选择迁移到新值。
  if (value === "liquid" || value === "aurora") return "bloom";
  if (value === undefined && legacyAmbientCoverTint === false) return "none";
  return DEFAULT_IMMERSIVE_BACKGROUND;
}
