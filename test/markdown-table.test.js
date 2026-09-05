// [Claude claude-opus-5[1m]-authored file]
// Prompt summary: "ensure we have a helper method for returning all the rows in a table, perhaps with a set of
//   labels that are passed in to the function"
import { escapedCellFromText, plainCellFromText, tableHeaderFromColumns, tableRowFromCells,
  tableRowsFromMarkdown } from "util/markdown-table";

const COLUMNS = [{ key: "dayKey", label: "Date" }, { key: "decision", label: "Approved/rejected" },
  { key: "title", label: "Task suggested" }];

// ----------------------------------------------------------------------------------------------
// @desc Render a whole table (header, separator, rows) the way a widget's note writer does.
// @param {Array<Array<*>>} rowCells - Each row's cell values, in column order.
// @returns {string}
function tableMarkdown(rowCells) {
  return [tableHeaderFromColumns(COLUMNS), ...rowCells.map(tableRowFromCells)].join("\n");
}

// [Claude claude-opus-5[1m]] Generated tests for: the shared markdown-table read/write helper
describe("markdown-table", () => {
  it("writes a header row and its separator from the column labels", () => {
    expect(tableHeaderFromColumns(COLUMNS))
      .toBe("| Date | Approved/rejected | Task suggested |\n| --- | --- | --- |");
  });

  it("returns every data row keyed by column key, skipping the header and separator", () => {
    const markdown = tableMarkdown([["2026-09-04", "Approved", "Draft the Q4 roadmap"],
      ["2026-09-05", "Rejected", "Reorganize the bookmarks"]]);

    expect(tableRowsFromMarkdown(markdown, { columns: COLUMNS })).toEqual([
      { dayKey: "2026-09-04", decision: "Approved", title: "Draft the Q4 roadmap" },
      { dayKey: "2026-09-05", decision: "Rejected", title: "Reorganize the bookmarks" }]);
  });

  it("round-trips cells containing pipes and newlines", () => {
    const markdown = tableMarkdown([["2026-09-04", "Approved", "Ship A | B test\nand write it up"]]);

    expect(markdown).toContain("Ship A \\| B test and write it up");
    expect(tableRowsFromMarkdown(markdown, { columns: COLUMNS })[0].title).toBe("Ship A | B test and write it up");
  });

  it("ignores prose around the table and rows with too few cells", () => {
    const markdown = `Some intro prose.\n\n${ tableMarkdown([["2026-09-04", "Approved", "Draft the Q4 roadmap"]]) }`
      + "\n| 2026-09-05 | Rejected |\n\nA closing paragraph.";

    expect(tableRowsFromMarkdown(markdown, { columns: COLUMNS })).toHaveLength(1);
  });

  it("reads shorter rows when requiredCellCount allows a column added later", () => {
    const markdown = "| Date | Approved/rejected |\n| --- | --- |\n| 2026-09-04 | Approved |";

    expect(tableRowsFromMarkdown(markdown, { columns: COLUMNS, requiredCellCount: 2 })).toEqual([
      { dayKey: "2026-09-04", decision: "Approved", title: "" }]);
  });

  it("skips separator rows written without padding or with alignment colons", () => {
    const markdown = "| Date | Approved/rejected | Task suggested |\n|------|:---:|---:|\n"
      + "| 2026-09-04 | Approved | Go |";

    expect(tableRowsFromMarkdown(markdown, { columns: COLUMNS })).toHaveLength(1);
  });

  it("tolerates absent or non-string markdown", () => {
    expect(tableRowsFromMarkdown(null, { columns: COLUMNS })).toEqual([]);
    expect(tableRowsFromMarkdown("", { columns: COLUMNS })).toEqual([]);
  });

  it("normalizes cell values, escaping only on the write side", () => {
    expect(plainCellFromText("  a | b\nc  ")).toBe("a | b c");
    expect(escapedCellFromText("  a | b\nc  ")).toBe("a \\| b c");
    expect(plainCellFromText(null)).toBe("");
    expect(tableRowFromCells(["a", 2, null])).toBe("| a | 2 |  |");
  });
});
