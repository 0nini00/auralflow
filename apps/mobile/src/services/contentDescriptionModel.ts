const COLLAPSED_DESCRIPTION_LINES = 3;

export interface ContentDescriptionModel {
  show: boolean;
  text: string;
  numberOfLines?: number;
  toggleLabel: string;
  expanded: boolean;
}

export function buildContentDescriptionModel(
  description: string | null | undefined,
  expanded: boolean,
): ContentDescriptionModel {
  const text = (description ?? "").trim();
  const isExpanded = Boolean(expanded);

  return {
    show: text.length > 0,
    text,
    numberOfLines: text.length === 0 || isExpanded ? undefined : COLLAPSED_DESCRIPTION_LINES,
    toggleLabel: isExpanded ? "收起" : "展开",
    expanded: isExpanded,
  };
}
