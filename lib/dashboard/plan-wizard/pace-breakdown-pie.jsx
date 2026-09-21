// The small ring chart the progress rail draws under "Project cadence": one slice per rhythm, sized by how many
// projects the user put on it. The rail is too narrow for a legend, so the caption beside the ring does that job
// on demand: it reads "N projects paced" at rest and names the rhythm and its count while a slice is hovered.
//
// It is drawn as a ring rather than a filled pie so the gaps between slices can be true gaps. A filled pie would
// need its separators painted in the row's background, and that background changes as the row is hovered or
// becomes the current step.

import { useState } from "react";

const PIE_SIZE = 44;
const RING_RADIUS = 16;
const SLICE_GAP = 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// ----------------------------------------------------------------------------------------------
// @desc Lay the slices end to end around the ring, recording where each starts and how long its arc is. Each
//   arc gives up SLICE_GAP of its length so neighboring slices stay visibly apart; a lone slice keeps the whole
//   ring, since there is no neighbor to separate it from.
// @param {Array<object>} paceSlices - Entries from paceSlicesFromContext: { count, label, value }.
// @returns {Array<object>} The same entries, each with arcLength and arcOffset added.
function ringArcsFromSlices(paceSlices) {
  const totalCount = paceSlices.reduce((runningTotal, paceSlice) => runningTotal + paceSlice.count, 0);
  const gapLength = paceSlices.length > 1 ? SLICE_GAP : 0;
  let arcStart = 0;
  return paceSlices.map(paceSlice => {
    const fullLength = (paceSlice.count / totalCount) * RING_CIRCUMFERENCE;
    const ringArc = { ...paceSlice, arcLength: Math.max(fullLength - gapLength, 0.5), arcOffset: arcStart };
    arcStart += fullLength;
    return ringArc;
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Render the pace breakdown ring and its hover caption.
// @param {object} params - An object with the following properties:
//   - {Array<object>} paceSlices - Per-rhythm counts from paceSlicesFromContext, in pace-option order.
//   - {string} summary - The breakdown in words, used as the chart's accessible name.
// @returns {JSX.Element} The ring chart with its caption.
export default function PaceBreakdownPie({ paceSlices, summary }) {
  const [hoveredPaceValue, setHoveredPaceValue] = useState(null);
  const ringArcs = ringArcsFromSlices(paceSlices);
  const totalCount = paceSlices.reduce((runningTotal, paceSlice) => runningTotal + paceSlice.count, 0);
  const hoveredArc = ringArcs.find(ringArc => ringArc.value === hoveredPaceValue);
  const captionText = hoveredArc ? `${ hoveredArc.count } · ${ hoveredArc.label }`
    : `${ totalCount } project${ totalCount === 1 ? "" : "s" } paced`;

  return (
    <span className="pace-breakdown-pie">
      <svg aria-label={ summary } className="pace-breakdown-ring" height={ PIE_SIZE } role="img"
        onMouseLeave={ () => setHoveredPaceValue(null) } viewBox={ `0 0 ${ PIE_SIZE } ${ PIE_SIZE }` } width={ PIE_SIZE }>
        <g transform={ `rotate(-90 ${ PIE_SIZE / 2 } ${ PIE_SIZE / 2 })` }>
          { ringArcs.map(ringArc => {
            const sliceClassNames = ["pace-breakdown-slice", `pace-breakdown-slice--${ ringArc.value }`];
            if (hoveredPaceValue === ringArc.value) sliceClassNames.push("pace-breakdown-slice--hovered");
            if (hoveredPaceValue && hoveredPaceValue !== ringArc.value) sliceClassNames.push("pace-breakdown-slice--dimmed");
            return (
              <circle className={ sliceClassNames.join(" ") } cx={ PIE_SIZE / 2 } cy={ PIE_SIZE / 2 } key={ ringArc.value }
                onMouseEnter={ () => setHoveredPaceValue(ringArc.value) } r={ RING_RADIUS }
                strokeDasharray={ `${ ringArc.arcLength } ${ RING_CIRCUMFERENCE }` } strokeDashoffset={ -ringArc.arcOffset }>
                <title>{ `${ ringArc.count } · ${ ringArc.label }` }</title>
              </circle>
            );
          }) }
        </g>
      </svg>
      <span aria-hidden="true" className="pace-breakdown-caption">{ captionText }</span>
    </span>
  );
}
