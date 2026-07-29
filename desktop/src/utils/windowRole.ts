export type AppWindowRole = "main" | "lyric" | "lyric-unlock";

export function detectWindowRoleFromParts(label?: string, hash?: string): AppWindowRole {
  if (label === "lyric") return "lyric";
  if (label === "lyric-unlock") return "lyric-unlock";
  if (hash?.startsWith("#/lyric-unlock")) return "lyric-unlock";
  if (hash?.startsWith("#/lyric")) return "lyric";
  return "main";
}
