// Lay out the Quarter Retrospective's progress heap: every completed task as a block dropped, oldest first, onto a pile
// that grows into a mountain. Each block lands in the column where the pile is lowest once a slope toward the middle is
// counted, so the pile keeps a peak at the center and spreads to both edges as it grows. The layout is computed here,
// apart from the renderer, so the same pile can be drawn with elements or on a canvas.
export const HEAP_MINIMUM_COLUMNS = 9;
export const HEAP_MAXIMUM_COLUMNS = 41;
// Columns per square root of the pile's area, which keeps its peak a little lower than it is wide.
const COLUMNS_PER_AREA_ROOT = 1.4;
// How much of one column's slope a block's landing spot may wander, so the pile looks tumbled rather than stacked.
const LANDING_JITTER = 0.8;

// ----------------------------------------------------------------------------------------------
// @desc Place every block on the pile.
// @param {Array<Array<number>>} blocks - [slot, size] per block in the order they fall, as progressHeap holds them.
// @returns {object} An object with the following properties:
//   - {number} columnCount - How many columns the pile spans
//   - {number} height - The tallest column, in block units; at least 1
//   - {Array<object>} placed - { bottom, column, size, slot } per block, in the order given; bottom and size are in block
//     units, column counts from 0 at the left
export function progressHeapLayout(blocks) {
  const sizes = (blocks || []).map(block => Math.max(1, Number(block?.[1]) || 1));
  const area = sizes.reduce((total, size) => total + size, 0);
  const columnCount = heapColumnCount(area);
  // A triangle as wide as the pile and holding its whole area rises this much per column toward the middle.
  const slope = (4 * area) / (columnCount * columnCount);
  const center = (columnCount - 1) / 2;
  const heights = new Array(columnCount).fill(0);
  const placed = (blocks || []).map((block, index) => {
    const size = sizes[index];
    const column = _landingColumn(heights, { center, index, slope });
    const bottom = heights[column];
    heights[column] += size;
    return { bottom, column, size, slot: Number(block?.[0]) || 0 };
  });
  return { columnCount, height: Math.max(1, ...heights), placed };
}

// ----------------------------------------------------------------------------------------------
// @desc How many columns a pile of a given area spreads across.
// @param {number} area - The sum of the blocks' sizes.
// @returns {number} Between HEAP_MINIMUM_COLUMNS and HEAP_MAXIMUM_COLUMNS, always odd so the pile has one middle column.
export function heapColumnCount(area) {
  const estimated = Math.round(Math.sqrt(Math.max(0, area)) * COLUMNS_PER_AREA_ROOT);
  const bounded = Math.min(HEAP_MAXIMUM_COLUMNS, Math.max(HEAP_MINIMUM_COLUMNS, estimated));
  return bounded % 2 ? bounded : bounded + 1;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The column a block lands in: the lowest once each column is raised by its distance from the middle times the
//   slope, plus a small jitter that depends only on the block and column, so the same blocks always make the same pile.
//   A tie goes to the column nearer the middle, then to the left.
// @param {Array<number>} heights - Each column's height so far.
// @param {object} options - { center, index, slope }: the middle column, the block's place in the fall, and the slope.
// @returns {number} The column index.
function _landingColumn(heights, { center, index, slope }) {
  let bestColumn = 0;
  let bestScore = Infinity;
  for (let column = 0; column < heights.length; column += 1) {
    const jitter = (((index + 1) * 7919 + (column + 1) * 104729) % 97) / 97;
    const score = heights[column] + slope * Math.abs(column - center) + jitter * slope * LANDING_JITTER;
    const nearer = score === bestScore && Math.abs(column - center) < Math.abs(bestColumn - center);
    if (score < bestScore || nearer) {
      bestColumn = column;
      bestScore = score;
    }
  }
  return bestColumn;
}
