// Side control on the Quarterly Planning pager. The label is the quarter a click brings into the pair.

// ----------------------------------------------------------------------------------------------
// @desc One side of the quarter pager. Previous sits to the left of the cards and following to the right.
//   The quarter name is written vertically so the control stays narrow beside the cards.
// @param {object} props - An object with the following properties:
//   - {string} direction - "previous" or "following", which also picks the chevron side.
//   - {Function} onClick - Moves the pager one quarter in this direction.
//   - {object} quarter - { label } of the quarter this click will bring into view.
// @returns {JSX.Element} The button.
export default function QuarterPageButton({ direction, onClick, quarter }) {
  const chevronFirst = direction === "previous";
  const chevron = <QuarterPageChevron direction={ direction } />;
  return (
    <button aria-label={ `Show ${ quarter.label }` }
      className={ `quarter-page-button quarter-page-button--${ direction }` } onClick={ onClick }
      title={ `Show ${ quarter.label }` } type="button">
      { chevronFirst ? chevron : null }
      <span className="quarter-page-label">{ quarter.label }</span>
      { chevronFirst ? null : chevron }
    </button>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Stroke chevron pointing at the quarter the button visits.
// @param {object} props - { direction } "previous" or "following".
// @returns {JSX.Element} A 16px chevron.
function QuarterPageChevron({ direction }) {
  const path = direction === "previous" ? "M14 5 L8 12 L14 19" : "M10 5 L16 12 L10 19";
  return (
    <svg aria-hidden="true" className="quarter-page-chevron" viewBox="0 0 24 24">
      <path d={ path } fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}
