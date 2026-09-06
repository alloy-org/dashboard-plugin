
# Reading Amplenote Rich Footnotes

Bill frequently puts substantive specifications and class definitions in Rich Footnotes. When interpreting his
notes, read the raw markdown and resolve the referenced definitions before summarizing or designing from it.
A rendered page or its visible link labels may omit the most important details.

The [official markdown reference](https://www.amplenote.com/help/plugin_api_markdown_reference_parse_markdown)
shows references such as `[label][^1]` paired with a later definition beginning `[^1]:`. Definitions can include
a description link with an empty destination, images, and additional content.

Example shaped like Bill's planning note:

````markdown
Possible projects are represented by [ActionProspect][^4].

[^4]: [ActionProspect]()

    Additional explanation, followed by a proposed record:

    ```
    { summary: "Calendar task suggestions", relatedTasks: [uuid1, uuid2] }
    ```
````

Interpretation and preservation rules:

- The visible label identifies the attachment point; the matching definition contains the supporting content.
  A standalone `[^1]` after an image may carry its transcription or other supporting text.
- An empty `()` does not mean the footnote is empty or broken. Read everything belonging to its definition.
- Preserve multiline content, paragraph breaks, lists, and fenced code, including indented continuation lines.
  Do not stop at the first blank line or flatten all indentation before interpreting code.
- Resolve references against the full note before excerpting sections. Relevant definitions may be at the end
  of the document, far from the heading being read. Retain each definition's identifier and reference context.
- Treat code fences as code: apparent headings or footnote markers inside them are not document structure.
  Follow nested references if present, with cycle protection; report missing definitions instead of guessing.
- The planning note's record examples are sketches, not valid JSON: they include comments, bare UUID placeholders,
  missing commas, and bracketed enum alternatives. Normalize them into a schema; never evaluate them as code.
- Backslash-only lines can represent Amplenote blank paragraphs. They are not model fields.
- When editing a note, preserve definitions used outside the edited section. Avoid renumbering or discarding
  footnotes just because their references were outside the excerpt.

In the [Quarterly plan builder brainstorming note](https://public.amplenote.com/t85cci4pmXL6of2XmtnW75wt.md),
definitions 2–5 contain `IntentPossibility`, `GoalSet`, `ActionProspect`, and `ProspectTask`; definition 6 repeats
`ActionProspect`. Definitions 1 and 7–11 contain text associated with the UI images.

The existing `lib/util/amplenote-markdown-render.js` handles browser display and imports tooltip/style code.
Do not import it into host services. A future shared parser should preserve raw structured content in a plain
JavaScript utility; display code can consume it separately.
