import { describe, expect, it } from "vitest";

import { buildContentDescriptionModel } from "@/services/contentDescriptionModel";

describe("content description model", () => {
  it("hides the section when description is blank", () => {
    expect(buildContentDescriptionModel("   ", false)).toEqual({
      show: false,
      text: "",
      numberOfLines: undefined,
      toggleLabel: "展开",
      expanded: false,
    });
  });

  it("collapses long descriptions to match desktop detail pages", () => {
    expect(buildContentDescriptionModel("专辑简介", false)).toEqual({
      show: true,
      text: "专辑简介",
      numberOfLines: 3,
      toggleLabel: "展开",
      expanded: false,
    });
  });

  it("removes the line clamp when expanded", () => {
    expect(buildContentDescriptionModel("歌手简介", true)).toEqual({
      show: true,
      text: "歌手简介",
      numberOfLines: undefined,
      toggleLabel: "收起",
      expanded: true,
    });
  });
});
