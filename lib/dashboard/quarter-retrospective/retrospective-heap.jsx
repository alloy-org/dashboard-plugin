// The Quarter Retrospective's progress heap: every completed task falls, oldest first, as a small block onto a pile
// that grows into a mountain, colored by project and sized by Victory Value, with a legend of the projects beneath.
// Up to HEAP_ELEMENT_LIMIT blocks are drawn as elements the stylesheet animates; a larger pile is drawn on a canvas.
// With reduced motion the finished pile is shown at once.
import { progressHeapLayout } from "dashboard/quarter-retrospective/retrospective-heap-layout";
import { useEffect, useMemo, useRef } from "react";
import { prefersReducedMotion } from "util/browser-utility";

export const HEAP_ELEMENT_LIMIT = 400;
// The blocks start falling across this long, however many there are, so a large pile lands no later than a small one.
export const HEAP_DROP_MILLISECONDS = 3600;
const HEAP_FALL_MILLISECONDS = 600;
const HEAP_LONGEST_STEP_MILLISECONDS = 40;
const NO_PROJECT_LABEL = "No project";
const NO_PROJECT_CANVAS_COLOR = "rgba(255, 255, 255, 0.55)";
const LEGEND_LABEL_MAX_CHARACTERS = 50;

// ----------------------------------------------------------------------------------------------
// @desc The delay between one block's start and the next.
// @param {number} blockCount - Blocks in the pile.
// @returns {number} Milliseconds.
function heapStepMilliseconds(blockCount) {
  return Math.min(HEAP_LONGEST_STEP_MILLISECONDS, HEAP_DROP_MILLISECONDS / Math.max(1, blockCount));
}

// ----------------------------------------------------------------------------------------------
// @desc The pile as positioned elements. Each block falls from above the pile to its place, by its own height times
//   how far it has to fall, so the animation moves blocks without laying the pile out again.
// @param {object} props - { label, layout }: the pile's accessible name and its progressHeapLayout.
// @returns {JSX.Element} The pile.
function HeapBlocks({ label, layout }) {
  const stepMilliseconds = heapStepMilliseconds(layout.placed.length);
  return (
    <div aria-label={ label } className="retrospective-heap-pile" role="img">
      { layout.placed.map((block, index) => {
        const fallHeights = (layout.height - block.bottom) / block.size + 1;
        const style = { "--heap-fall": fallHeights, animationDelay: `${ Math.round(index * stepMilliseconds) }ms`,
          bottom: `${ (block.bottom / layout.height) * 100 }%`, height: `${ (block.size / layout.height) * 100 }%`,
          left: `${ (block.column / layout.columnCount) * 100 }%`, width: `${ 100 / layout.columnCount }%` };
        return <span className={ `retrospective-heap-block retrospective-heap-block--slot-${ block.slot }` } key={ index } style={ style } />;
      }) }
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc The pile drawn on a canvas, for piles too large to draw as elements. Project colors are read from the theme's
//   category tokens. Without a 2D context, as in jsdom, nothing is drawn.
// @param {object} props - { label, layout }: the pile's accessible name and its progressHeapLayout.
// @returns {JSX.Element} The canvas.
function HeapCanvas({ label, layout }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext?.("2d");
    if (!context) return undefined;
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
    const columnWidth = canvas.width / layout.columnCount;
    const unitHeight = canvas.height / layout.height;
    const computedStyle = getComputedStyle(canvas);
    const colorBySlot = slot => (slot ? computedStyle.getPropertyValue(`--dashboard-color-category-${ slot }`).trim() || NO_PROJECT_CANVAS_COLOR
      : NO_PROJECT_CANVAS_COLOR);
    const stepMilliseconds = heapStepMilliseconds(layout.placed.length);
    // @desc Draw every block that has started falling, each at its place in its fall.
    const draw = elapsed => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      layout.placed.forEach((block, index) => {
        const progress = Math.min(1, Math.max(0, (elapsed - index * stepMilliseconds) / HEAP_FALL_MILLISECONDS));
        if (!progress) return;
        const eased = 1 - Math.pow(1 - progress, 3);
        const restingTop = canvas.height - (block.bottom + block.size) * unitHeight;
        const top = restingTop - (1 - eased) * (restingTop + block.size * unitHeight);
        context.fillStyle = colorBySlot(block.slot);
        context.fillRect(block.column * columnWidth + 0.5, top + 0.5, columnWidth - 1, block.size * unitHeight - 1);
      });
    };
    const totalMilliseconds = layout.placed.length * stepMilliseconds + HEAP_FALL_MILLISECONDS;
    if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
      draw(totalMilliseconds);
      return undefined;
    }
    let frameId = null;
    const startedAt = performance.now();
    const step = now => {
      const elapsed = now - startedAt;
      draw(elapsed);
      if (elapsed < totalMilliseconds) frameId = requestAnimationFrame(step);
    };
    frameId = requestAnimationFrame(step);
    return () => { if (frameId !== null) cancelAnimationFrame(frameId); };
  }, [layout]);

  return <canvas aria-label={ label } className="retrospective-heap-pile retrospective-heap-canvas" ref={ canvasRef } role="img" />;
}

// ----------------------------------------------------------------------------------------------
// @desc A legend entry's text: the project name, cut to LEGEND_LABEL_MAX_CHARACTERS with an ellipsis when longer,
//   followed by its completed task count in parentheses.
// @param {object} entry - { label, taskCount } from the heap's legend.
// @returns {string} The text shown beside the entry's swatch.
function legendEntryText({ label, taskCount }) {
  const shortLabel = label.length > LEGEND_LABEL_MAX_CHARACTERS ? `${ label.slice(0, LEGEND_LABEL_MAX_CHARACTERS - 1).trimEnd() }…` : label;
  return `${ shortLabel } (${ taskCount.toLocaleString() })`;
}

// ----------------------------------------------------------------------------------------------
// @desc The heap and its legend. Each legend entry names its project, truncated to LEGEND_LABEL_MAX_CHARACTERS, and
//   how many completed tasks it contributed.
// @param {object} props - An object with the following properties:
//   - {object} heap - { blocks, legend } from the statistics' progressHeap
// @returns {JSX.Element} The heap.
export default function RetrospectiveHeap({ heap }) {
  const layout = useMemo(() => progressHeapLayout(heap.blocks), [heap]);
  const taskWord = layout.placed.length === 1 ? "task" : "tasks";
  const label = `A pile of ${ layout.placed.length.toLocaleString() } completed ${ taskWord }`;
  const noProjectTaskCount = heap.blocks.filter(([slot]) => !slot).length;
  const legend = [...(heap.legend || [])];
  if (legend.length && noProjectTaskCount) legend.push({ label: NO_PROJECT_LABEL, slot: 0, taskCount: noProjectTaskCount });
  return (
    <div className="retrospective-heap">
      { layout.placed.length > HEAP_ELEMENT_LIMIT ? <HeapCanvas label={ label } layout={ layout } /> : <HeapBlocks label={ label } layout={ layout } /> }
      { legend.length ? (
        <ul className="retrospective-heap-legend">
          { legend.map(entry => (
            <li className="retrospective-heap-legend-entry" key={ `${ entry.slot }-${ entry.label }` }>
              <span className={ `retrospective-heap-swatch retrospective-heap-block--slot-${ entry.slot }` } />
              <span title={ entry.label }>{ legendEntryText(entry) }</span>
            </li>
          )) }
        </ul>
      ) : null }
    </div>
  );
}
