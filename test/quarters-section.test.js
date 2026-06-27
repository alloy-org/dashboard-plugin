// [Claude claude-opus-4-8] Generated tests for: extractMonthSectionContent trailing backslash handling
import { extractMonthSectionContent } from "constants/quarters";

describe("extractMonthSectionContent", () => {
  it("extracts the content under a matching month heading", () => {
    const md = "# June\n- Focus: ship it\n- Key move: test\n\n# July\n- next";
    expect(extractMonthSectionContent(md, "June")).toBe("- Focus: ship it\n- Key move: test");
  });

  it("strips a trailing Amplenote blank-line marker (a lone backslash)", () => {
    const md = "# June\n- Focus: ship it\n- Key move: test\n\\";
    expect(extractMonthSectionContent(md, "June")).toBe("- Focus: ship it\n- Key move: test");
  });

  it("strips multiple trailing backslash-only lines with surrounding whitespace", () => {
    const md = "# June\n- a\n- b\n\\\n  \\  \n\\";
    expect(extractMonthSectionContent(md, "June")).toBe("- a\n- b");
  });

  it("preserves backslashes that are not trailing", () => {
    const md = "# June\n- path: C:\\\\temp\n- done";
    expect(extractMonthSectionContent(md, "June")).toBe("- path: C:\\\\temp\n- done");
  });

  it("returns null when the heading is absent", () => {
    expect(extractMonthSectionContent("# May\n- stuff", "June")).toBeNull();
  });
});
