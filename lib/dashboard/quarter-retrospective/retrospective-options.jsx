// The Quarter Retrospective's options screen: a card per style and, above them, the toggles that apply to this
// quarter: the calendar, when the journal recorded any of it, and images from the user's notes. Choosing a style card
// starts generating at once, so the click that chose it is the gesture a later phase starts music from.
import { AVAILABLE_RETROSPECTIVE_STYLES } from "dashboard/quarter-retrospective/retrospective-generation";
import { retrospectiveStyleLabel } from "dashboard/quarter-retrospective/retrospective-data-note";
import { RETROSPECTIVE_STYLES } from "dashboard/quarter-retrospective/retrospective-slides";
import { useState } from "react";

const STYLE_DESCRIPTIONS = Object.freeze({
  data: "The numbers, laid out plainly: where your time and Victory Value went.",
  roast: "The same facts, with some affectionate ribbing.",
  spotify: "Your quarter as an upbeat year-in-review story, down to its genre.",
});

// ----------------------------------------------------------------------------------------------
// @desc One style's card. A style that can't be generated yet is shown disabled, so the user knows it's coming.
// @param {object} props - { available, onChoose, style }.
// @returns {JSX.Element} The card.
function StyleCard({ available, onChoose, style }) {
  const label = retrospectiveStyleLabel(style);
  return (
    <button className={ `retrospective-style-card retrospective-style-card--${ style }` } disabled={ !available } onClick={ onChoose }
      type="button">
      <span className="retrospective-style-card-title">{ label }</span>
      <span className="retrospective-style-card-description">{ STYLE_DESCRIPTIONS[style] }</span>
      { available ? null : <span className="retrospective-style-card-soon">Coming soon</span> }
    </button>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc The options screen.
// @param {object} props - An object with the following properties:
//   - {object|null} calendarCoverage - { coveredDays, totalDays } from the calendar journal, or null when unknown
//   - {Function} onChoose - Receives (style, options), options being { includeCalendar, includeImages }
//   - {string} quarterLabel - Such as "Q3 2026"
// @returns {JSX.Element} The screen.
export default function RetrospectiveOptions({ calendarCoverage, onChoose, quarterLabel }) {
  const calendarAvailable = !!calendarCoverage?.coveredDays;
  const [includeCalendar, setIncludeCalendar] = useState(true);
  const [includeImages, setIncludeImages] = useState(true);
  const styles = Object.values(RETROSPECTIVE_STYLES);
  const chooseStyle = style => () => onChoose(style, { includeCalendar: calendarAvailable && includeCalendar, includeImages });

  return (
    <div className="retrospective-options">
      <p className="retrospective-options-kicker">Your quarter in review</p>
      <h2 className="retrospective-options-headline">{ `How should we tell ${ quarterLabel }?` }</h2>
      { calendarAvailable ? (
        <label className="retrospective-options-toggle">
          <input checked={ includeCalendar } onChange={ event => setIncludeCalendar(event.target.checked) } type="checkbox" />
          <span>{ `Include calendar events (your calendar covers ${ calendarCoverage.coveredDays } of ${ calendarCoverage.totalDays } days)` }</span>
        </label>
      ) : null }
      <label className="retrospective-options-toggle">
        <input checked={ includeImages } onChange={ event => setIncludeImages(event.target.checked) } type="checkbox" />
        <span>Show images from my notes, when any fit (Roast and Spotify)</span>
      </label>
      <div className="retrospective-style-cards">
        { styles.map(style => (
          <StyleCard available={ AVAILABLE_RETROSPECTIVE_STYLES.includes(style) } key={ style } onChoose={ chooseStyle(style) } style={ style } />
        )) }
      </div>
    </div>
  );
}
