// Tests for reading the payload of a note's ```json fence when stored strings themselves contain ```.
import { jsonFenceContent } from "util/json-utility";

describe("jsonFenceContent", () => {
  it("keeps a payload whose string values contain a code fence", () => {
    const payload = { records: [{ title: "Fix the ```js snippet``` here" }] };
    const content = ["# Title", "", "Explanation", "", "```json", JSON.stringify(payload), "```", ""].join("\n");

    expect(JSON.parse(jsonFenceContent(content))).toEqual(payload);
  });

  it("reads a fence closed on the same line as its payload", () => {
    expect(jsonFenceContent("```json {\"a\":1}```")).toBe("{\"a\":1}");
  });

  it("returns null without a json fence", () => {
    expect(jsonFenceContent("no fence here")).toBeNull();
    expect(jsonFenceContent(null)).toBeNull();
  });
});
