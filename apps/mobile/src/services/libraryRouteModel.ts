import type { MainDrawerParamList } from "@/navigation/types";
import type { LibrarySection } from "@/services/librarySectionModel";

type LibraryRouteName = "MainTabs";

export function getLibrarySectionForRoute(
  routeName: LibraryRouteName,
  params?: { section?: "history" | "bili" },
): Exclude<LibrarySection, "downloads"> {
  return params?.section ?? "history";
}

export function getLibraryNavigationTarget(
  section: LibrarySection,
): {
  name: keyof MainDrawerParamList;
  params?: MainDrawerParamList[keyof MainDrawerParamList];
} {
  return { name: "MainTabs" };
}
