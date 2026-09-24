// Verify that content written back into a note flattens markdown that would break bracket pairing, and that
// carried-forward footnote references are renumbered as ascending integers scoped to the write.
import { footnoteDefinitionsMarkdown, footnoteNumbering, footnoteSafeLinkMarkdown,
  linkLabelFromMarkdown } from "util/amplenote-rich-footnote-writing";

describe("linkLabelFromMarkdown", () => {
  it("flattens a link the source text carried into its label text", () => {
    const label = linkLabelFromMarkdown("See [the plan](https://example.com/plan) first");
    expect(label).toBe("See the plan first");
  });

  it("flattens images and stray brackets", () => {
    const label = linkLabelFromMarkdown("![chart](https://example.com/c.png) and a ] stray");
    expect(label).toBe("chart and a stray");
  });

  it("drops footnote references when no numbering state can carry their definitions", () => {
    const label = linkLabelFromMarkdown("Ship the [meter][^7] soon", null);
    expect(label).toBe("Ship the meter soon");
  });

  it("falls back when nothing readable survives", () => {
    expect(linkLabelFromMarkdown("[]", null, "Untitled task")).toBe("Untitled task");
    expect(linkLabelFromMarkdown("", null, "Untitled project")).toBe("Untitled project");
  });
});

describe("footnote numbering", () => {
  it("renumbers references from one in first-cited order and defines each", () => {
    const numbering = footnoteNumbering();
    const first = linkLabelFromMarkdown("Ship the [meter][^7] soon", numbering);
    const second = linkLabelFromMarkdown("Revisit the [rollout plan][^3]", numbering);
    expect(first).toBe("Ship the meter[^1] soon");
    expect(second).toBe("Revisit the rollout plan[^2]");
    expect(footnoteDefinitionsMarkdown(numbering)).toBe("\n[^1]: Referenced from the source task: meter\n"
      + "[^2]: Referenced from the source task: rollout plan\n");
  });

  it("shares one number and one definition between passages citing the same identifier", () => {
    const numbering = footnoteNumbering();
    linkLabelFromMarkdown("Ship the [meter][^7] soon", numbering);
    const second = linkLabelFromMarkdown("The [meter][^7] again", numbering);
    expect(second).toBe("The meter[^1] again");
    expect(numbering.definitions).toHaveLength(1);
  });

  it("emits nothing when no reference was cited", () => {
    expect(footnoteDefinitionsMarkdown(footnoteNumbering())).toBe("");
  });
});

describe("footnoteSafeLinkMarkdown", () => {
  it("keeps footnote markers outside the link label", () => {
    const numbering = footnoteNumbering();
    const markdown = footnoteSafeLinkMarkdown("Ship the [meter][^7] soon", "https://example.com/t1", numbering);
    expect(markdown).toBe("[Ship the meter soon](https://example.com/t1)[^1]");
  });

  it("drops multiline footnote definitions carried in task content", () => {
    const taskText = "Ship the [meter][^4] soon\n\n[^4]: [meter]()\n\n    Captured from example.com\n\n"
      + "    ![](https://example.com/meter.png)\n";
    const markdown = footnoteSafeLinkMarkdown(taskText, "https://example.com/t1");
    expect(markdown).toBe("[Ship the meter soon](https://example.com/t1)");
  });

  it("flattens a nested link rather than nesting brackets inside the label", () => {
    const markdown = footnoteSafeLinkMarkdown("Read [the doc](https://example.com/d)", "https://example.com/t2");
    expect(markdown).toBe("[Read the doc](https://example.com/t2)");
  });
});
