// Several widgets persist their data as markdown tables inside an archived note and read it back on the next
// load (Energy Per Habit's month cache, the Proposed Agenda decision log). Each column is declared once as a
// `{ key, label }` pair: `label` is the header text written into the note and matched when reading it back,
// `key` is the property the parsed row object carries. Writing the header with tableHeaderFromColumns and
// reading with tableRowsFromMarkdown therefore keeps a note's two directions from drifting apart.

// ----------------------------------------------------------------------------------------------
// @desc Normalize a value for a table cell and escape the characters that would break the row apart: newlines
//   collapse to spaces and pipes are backslash-escaped, so the value survives the round trip through the note.
// @param {*} text - Raw cell value; null/undefined become "".
// @returns {string}
export function escapedCellFromText(text) {
  return plainCellFromText(text).replace(/\|/g, "\\|");
}

// ----------------------------------------------------------------------------------------------
// @desc Normalize a value for a table cell without escaping it — for values held in memory that are escaped
//   later, at serialization time, so a value read back out of a note is never escaped twice.
// @param {*} text - Raw cell value; null/undefined become "".
// @returns {string}
export function plainCellFromText(text) {
  return String(text ?? "").replace(/\r?\n/g, " ").trim();
}

// ----------------------------------------------------------------------------------------------
// @desc Render a table's header row and its `| --- |` separator from the column declarations.
// @param {Array<{key: string, label: string}>} columns - Column declarations, in column order.
// @returns {string} Two lines, newline-separated.
export function tableHeaderFromColumns(columns) {
  const labelRow = tableRowFromCells(columns.map(column => column.label));
  const separatorRow = `| ${ columns.map(() => "---").join(" | ") } |`;
  return `${ labelRow }\n${ separatorRow }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Render one table row, escaping each cell.
// @param {Array<*>} cellValues - Cell values in column order; numbers and null are stringified.
// @returns {string}
export function tableRowFromCells(cellValues) {
  return `| ${ (cellValues || []).map(escapedCellFromText).join(" | ") } |`;
}

// ----------------------------------------------------------------------------------------------
// @desc Return every data row of the markdown tables in `markdown`, as objects keyed by the columns' `key`.
//   The header row and the `| --- |` separator are skipped, cells are unescaped, and a missing trailing cell
//   reads as "". Every line that looks like a table row is considered, so pass one section's body rather than
//   a whole note when the note holds tables of differing shapes.
// @param {string} markdown - Note markdown, or one heading section's body.
// @param {object} params - { columns, requiredCellCount }.
//   - {Array<{key: string, label: string}>} columns - Column declarations, in column order.
//   - {number} [requiredCellCount=columns.length] - Cells a line must have to count as a row. Lower it when an
//     older revision of the table wrote fewer columns and those rows should still be read.
// @returns {Array<Object<string, string>>} One object per data row, in the order they appear.
export function tableRowsFromMarkdown(markdown, { columns, requiredCellCount = columns.length }) {
  const rows = [];
  if (!markdown || typeof markdown !== "string") return rows;
  const columnLabels = columns.map(column => String(column.label).toLowerCase());
  for (const line of markdown.split("\n")) {
    const cells = _cellsFromLine(line);
    if (!cells || cells.length < requiredCellCount) continue;
    if (_isSeparatorRow(cells) || _isHeaderRow(cells, columnLabels)) continue;
    const row = {};
    columns.forEach((column, index) => { row[column.key] = cells[index] ?? ""; });
    rows.push(row);
  }
  return rows;
}

// ----------------------------------------------------------------------------------------------
// @desc Split one line into its unescaped, trimmed cells, or null when the line is not a table row.
// @param {string} line - A single line of markdown.
// @returns {Array<string>|null}
function _cellsFromLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  // Split on unescaped pipes only, then unescape, so a cell containing "\|" survives the round trip.
  const innerCells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/);
  return innerCells.map(cell => cell.trim().replace(/\\\|/g, "|"));
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a row restates the column labels rather than carrying data. Only the cells the row actually
//   has are compared, so a header written before a column was appended is still recognized.
// @param {Array<string>} cells - The row's parsed cells.
// @param {Array<string>} columnLabels - Lower-cased column labels, in column order.
// @returns {boolean}
function _isHeaderRow(cells, columnLabels) {
  const comparableCount = Math.min(cells.length, columnLabels.length);
  if (comparableCount === 0) return false;
  const comparedCells = cells.slice(0, comparableCount);
  return comparedCells.every((cell, index) => cell.toLowerCase() === columnLabels[index]);
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a row is the `| --- |` separator beneath a header (alignment colons included).
// @param {Array<string>} cells - The row's parsed cells.
// @returns {boolean}
function _isSeparatorRow(cells) {
  return cells.every(cell => /^:?-+:?$/.test(cell.replace(/\s/g, "")));
}
