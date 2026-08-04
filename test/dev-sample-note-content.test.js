// [Claude claude-opus-5 (1M context)] Generated tests for: per-note dev sample content and the
//   block-level Amplenote renderer the dev htmlFromContent shim hands to Note Peek
const { sampleNoteContentFromUUID } = await import("util/dev-sample-notes");
const { amplenoteMarkdownRenderBlock } = await import("util/amplenote-markdown-render");

// The sample note carrying a Rich Footnote whose definition holds a link, a picture, and description
// text — the fixture Note Peek is meant to be pointed at in dev mode.
const FOOTNOTE_NOTE_UUID = "note-work-4";

describe("sampleNoteContentFromUUID", () => {
  it("gives each sample note its own body, naming the note it belongs to", () => {
    const goalReview = sampleNoteContentFromUUID("note-work-1");
    const standUp = sampleNoteContentFromUUID("note-work-2");
    const featureImplementation = sampleNoteContentFromUUID("note-work-3");
    expect(goalReview).toContain("Q1 Goal Review");
    expect(standUp).toContain("Stand-up Notes");
    expect(standUp).toContain("- [ ] Review the next action for Stand-up Notes");
    expect(featureImplementation).toContain("- [x] Capture the current state");
    expect(standUp).not.toBe(goalReview);
  });

  it("leaves a UUID that is not a sample note to the caller's own fallback", () => {
    expect(sampleNoteContentFromUUID("dashboard-state-note-uuid")).toBeNull();
  });

  it("offers a note whose Rich Footnote carries a link, a picture, and description text", () => {
    const content = sampleNoteContentFromUUID(FOOTNOTE_NOTE_UUID);
    expect(content).toMatch(/\[[^\]]+\]\[\^1\]/);
    expect(content).toContain("[^1]: [Widget chrome mock-up, third revision](https://www.amplenote.com)");
    expect(content).toMatch(/!\[Widget chrome mock-up\]\(https:\/\/images\.amplenote\.com\//);
  });
});

describe("amplenoteMarkdownRenderBlock", () => {
  it("renders block elements, unlike the inline renderer a task line uses", () => {
    const html = amplenoteMarkdownRenderBlock("# Roadmap\n\n- First\n- Second\n");
    expect(html).toContain("<h1");
    expect(html).toContain("<li>First</li>");
  });

  it("turns a note's Rich Footnote into a link carrying its picture and description", () => {
    const html = amplenoteMarkdownRenderBlock(sampleNoteContentFromUUID(FOOTNOTE_NOTE_UUID));
    const link = html.match(/data-rich-footnote="([^"]+)"/);
    expect(link).not.toBeNull();
    const footnote = JSON.parse(decodeURIComponent(link[1]));
    expect(footnote.url).toBe("https://www.amplenote.com");
    expect(footnote.description).toBe("Widget chrome mock-up, third revision");
    expect(footnote.images).toHaveLength(1);
    expect(footnote.text.join(" ")).toContain("walkthrough worked from");
    // Headings survive alongside the footnote handling, which the inline renderer would flatten.
    expect(html).toContain("<h2");
  });
});
