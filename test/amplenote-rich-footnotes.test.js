// Verify footnote definitions survive multiline prose, fenced code, empty description links, and nesting.

import { parsedRichFootnotes, passageWithResolvedFootnotes, referencedFootnoteIdentifiers,
  resolvedFootnotesForPassage } from "util/amplenote-rich-footnotes";

const planningNote = [
  "Possible projects are represented by [ActionProspect][^4].",
  "",
  "# Heading after the reference",
  "",
  "[^4]: [ActionProspect]()",
  "",
  "    Additional explanation, followed by a proposed record:",
  "",
  "    ```",
  "    {",
  "      summary: \"Calendar task suggestions\", // a sketch, not JSON",
  "",
  "      # not a heading",
  "      [^9]: not a definition",
  "      relatedTasks: [uuid1, uuid2]",
  "    }",
  "    ```",
  "",
  "    Scored by [ProspectTask][^5].",
  "\\",
  "[^5]: [ProspectTask]()",
  "",
  "    Match score is 1 through 10.",
  "",
  "[^7]: Transcription of the image, with no description link.",
].join("\n");

// ----------------------------------------------------------------------------------------------
// @desc Confirm a definition keeps its whole multiline body, including a fenced sketch whose contents look like
//   document structure, and that an empty description link is a label rather than an empty footnote.
// Truncating at the first blank line would discard exactly the specifications Bill stores in footnotes.
test("collects multiline definitions and treats fenced content as code", () => {
  const { body, definitions } = parsedRichFootnotes(planningNote);
  expect(body).toContain("# Heading after the reference");
  expect(body).not.toContain("Match score");
  const prospect = definitions.get("4");
  expect(prospect.label).toBe("ActionProspect");
  expect(prospect.body).toContain("Additional explanation");
  expect(prospect.body).toContain("  summary: \"Calendar task suggestions\"");
  expect(prospect.body).toContain("# not a heading");
  expect(prospect.body).toContain("[^9]: not a definition");
  expect(prospect.references).toEqual(["5"]);
  expect(definitions.get("5").body).toBe("Match score is 1 through 10.");
  expect(definitions.get("7")).toMatchObject({ body: "Transcription of the image, with no description link.", label: "" });
  expect(referencedFootnoteIdentifiers(body)).toEqual(["4"]);
});

// ----------------------------------------------------------------------------------------------
// @desc Confirm nested references resolve, cycles terminate, and an absent identifier is reported.
// A caller must be able to tell missing evidence from resolved evidence rather than guessing at content.
test("resolves nested references with cycle protection and reports missing definitions", () => {
  const { definitions } = parsedRichFootnotes(planningNote);
  const resolution = resolvedFootnotesForPassage("See [ActionProspect][^4] and [^12].", definitions);
  expect(resolution.resolved.map(definition => definition.identifier)).toEqual(["4", "5"]);
  expect(resolution.missingIdentifiers).toEqual(["12"]);

  const cyclic = parsedRichFootnotes(["[^a]: refers to [^b]", "[^b]: refers back to [^a]"].join("\n"));
  const cyclicResolution = resolvedFootnotesForPassage("start at [^a]", cyclic.definitions);
  expect(cyclicResolution.resolved.map(definition => definition.identifier)).toEqual(["a", "b"]);
  expect(cyclicResolution.missingIdentifiers).toEqual([]);
});

// ----------------------------------------------------------------------------------------------
// @desc Confirm the prompt-ready rendering carries the passage plus each definition it depends on.
// Evidence sent to inference must include the footnote bodies, since visible labels omit the details.
test("renders a passage together with the footnote bodies it depends on", () => {
  const { definitions } = parsedRichFootnotes(planningNote);
  const rendered = passageWithResolvedFootnotes("Projects use [ActionProspect][^4] and [^12].", definitions);
  expect(rendered).toContain("Projects use [ActionProspect][^4]");
  expect(rendered).toContain("[^4] ActionProspect");
  expect(rendered).toContain("Match score is 1 through 10.");
  expect(rendered).toContain("[^12] (definition not found in note)");
});
