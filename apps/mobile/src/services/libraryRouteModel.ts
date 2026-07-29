import type { MainDrawerParamList } from "@/navigation/types";
import type { LibrarySection } from "@/services/librarySectionModel";

type LibraryRouteName = "Playlists" | "Local" | "Library";

export function getLibrarySectionForRoute(
  routeName: LibraryRouteName,
  params?: { section?: "history" | "bili" },
): Exclude<LibrarySection, "downloads"> {
  if (routeName === "Playlists") return "playlists";
  if (routeName === "Local") return "local";
  return params?.section ?? "history";
}

export function getLibraryNavigationTarget(
  section: LibrarySection,
): {
  name: keyof MainDrawerParamList;
  params?: MainDrawerParamList[keyof MainDrawerParamList];
} {
  if (section === "playlists") return { name: "Playlists" };
  if (section === "local") return { name: "Local" };
  if (section === "downloads") return { name: "Downloads" };
  return { name: "Library", params: { section } };
}
