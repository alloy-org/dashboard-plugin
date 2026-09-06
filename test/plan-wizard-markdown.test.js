// Verify markdown structure, exact JSON round trips, and prose preservation.

import { guideHeadingRanges, guideSectionRange, initialVisionGuideMarkdown, parseJsonPayload, replaceJsonPayload } from "plan-wizard/vision-guide-markdown";

// ----------------------------------------------------------------------------------------------
// @desc Ignore heading-looking code while retaining hierarchy and metadata attributes.
// Fence-aware parsing is required for hand-edited datastore notes.
test("extracts heading subtrees without treating fenced examples as sections", () => {
  const markdown = "# Parent\nIntro\n```text\n# Fake\n```\n## Child\nBody\n# Sibling<!-- {\"collapsed\":true} -->\nTail\n";
  expect(guideHeadingRanges(markdown).map(heading => heading.text)).toEqual(["Parent", "Child", "Sibling"]);
  const range = guideSectionRange(markdown, "Parent");
  expect(markdown.slice(range.bodyStart, range.end)).toContain("## Child");
  expect(markdown.slice(range.bodyStart, range.end)).not.toContain("# Sibling");
  expect(() => guideSectionRange("# Repeat\n# Repeat\n", "Repeat")).toThrow("Duplicate");
  expect(() => guideHeadingRanges("```json\n{}\n")).toThrow("Unclosed");
});

// ----------------------------------------------------------------------------------------------
// @desc Preserve literal markdown characters and user text surrounding an owned payload.
// Footnotes, code, and pipes within goal text must survive a storage round trip.
test("round-trips JSON and preserves prose and trailing footnote definitions", () => {
  const body = "My explanation\n\n```json\n{\"goals\":[]}\n```\n\n[^1]: [Context]()\n    Keep this.\n";
  const payload = { goals: [{ goalText: "Use `code`, [Context][^1], | pipes and\nnewlines", extra: [null, { score: 2 }] }] };
  const updated = replaceJsonPayload(body, payload);
  expect(parseJsonPayload(updated).payload).toEqual(payload);
  expect(updated.startsWith("My explanation\n\n")).toBe(true);
  expect(updated.endsWith("[^1]: [Context]()\n    Keep this.\n")).toBe(true);
  expect(() => parseJsonPayload("```json\n{broken}\n```\n")).toThrow();
  expect(() => parseJsonPayload("```json\n{}\n```\n```json\n{}\n```\n")).toThrow("exactly one");
});

// ----------------------------------------------------------------------------------------------
// @desc Code examples can themselves contain apparent JSON fences; only an outer JSON block owns data.
test("ignores JSON examples nested inside a longer code fence", () => {
  const example = "````text\n```json\n{\"example\":true}\n```\n````\n";
  const body = `${ example }\n~~~json\n{\"goals\":[]}\n~~~~\n`;
  expect(parseJsonPayload(body).payload).toEqual({ goals: [] });
  expect(replaceJsonPayload(body, { goals: ["Real payload"] })).toContain(example);
});

// ----------------------------------------------------------------------------------------------
// @desc Create all quarterly leaves and reserve category-specific project sections once.
// The skeleton avoids structural writes during normal goal saves.
test("initializes all quarters within a domain/year guide", () => {
  const markdown = initialVisionGuideMarkdown({ domainName: "Work", domainUuid: "work", year: 2026 });
  const headings = guideHeadingRanges(markdown);
  expect(headings.filter(heading => heading.level === 3)).toHaveLength(12);
  expect(guideSectionRange(markdown, "Q4 2026 Picked intents")).not.toBeNull();
  const metadata = guideSectionRange(markdown, "Guide metadata");
  expect(parseJsonPayload(markdown.slice(metadata.bodyStart, metadata.end)).payload).toEqual({ domainName: "Work", domainUuid: "work", schemaVersion: 1, year: 2026 });
});
