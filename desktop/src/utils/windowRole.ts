export type AppWindowRole = "main" | "lyric" | "lyric-unlock" | "mini-player";

export function detectWindowRoleFromParts(label?: string, hash?: string): AppWindowRole {
  if (label === "lyric") return "lyric";
  if (label === "lyric-unlock") return "lyric-unlock";
  if (label === "mini-player") return "mini-player";
  if (hash?.startsWith("#/lyric-unlock")) return "lyric-unlock";
  if (hash?.startsWith("#/lyric")) return "lyric";
  if (hash?.startsWith("#/mini-player")) return "mini-player";
  return "main";
}

/** 除主窗口外都是「只显示 + 把动作转给主窗口」的从窗口。 */
export function isSecondaryWindowRole(role: AppWindowRole): boolean {
  return role !== "main";
}
