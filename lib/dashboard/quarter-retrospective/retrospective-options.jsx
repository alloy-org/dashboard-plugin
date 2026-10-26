// The Quarter Retrospective's options screen: a card per style and a card per soundtrack vibe, one of each chosen from
// the start, the toggles that apply to this quarter (the calendar, when the journal recorded any of it, and images from
// the user's notes), and a Generate button. The Generate click is the gesture a later phase starts music from.
import { AVAILABLE_RETROSPECTIVE_STYLES, DEFAULT_RETROSPECTIVE_SOUNDTRACK_VIBE, DEFAULT_RETROSPECTIVE_STYLE,
  RETROSPECTIVE_SOUNDTRACK_VIBES } from "dashboard/quarter-retrospective/retrospective-generation";
import { retrospectiveStyleLabel } from "dashboard/quarter-retrospective/retrospective-data-note";
import { RETROSPECTIVE_STYLES } from "dashboard/quarter-retrospective/retrospective-slides";
import { useState } from "react";

const STYLE_DESCRIPTIONS = Object.freeze({
  data: "The numbers, laid out plainly: where your time and Victory Value went.",
  roast: "The same facts, with some affectionate ribbing.",
  spotify: "Your quarter as an upbeat year-in-review story, down to its genre.",
});

const SOUNDTRACK_VIBE_CHOICES = Object.freeze([
  { description: "A mellow pad and an easy beat.", icon: "🌙", label: "Chill", vibe: RETROSPECTIVE_SOUNDTRACK_VIBES.chill },
  { description: "Retro synths with a steady drive.", icon: "🌆", label: "Synthwave", vibe: RETROSPECTIVE_SOUNDTRACK_VIBES.synthwave },
  { description: "Big, bright, and triumphant.", icon: "🏆", label: "Anthem", vibe: RETROSPECTIVE_SOUNDTRACK_VIBES.anthem },
]);

// ----------------------------------------------------------------------------------------------
// @desc One selectable card in a group where exactly one is chosen. A card that can't be chosen yet is shown disabled,
//   so the user knows it's coming.
// @param {object} props - An object with the following properties:
//   - {string} className - The card's modifier classes
//   - {string} description - One line under the title
//   - {boolean} [disabled] - Whether it can't be chosen yet
//   - {Function} onSelect - Chooses the card
//   - {boolean} selected - Whether it is the group's choice
//   - {string} title - The card's name
// @returns {JSX.Element} The card.
function ChoiceCard({ className, description, disabled = false, onSelect, selected, title }) {
  return (
    <button aria-checked={ selected } className={ `retrospective-choice-card ${ className }${ selected ? " retrospective-choice-card--selected" : "" }` }
      disabled={ disabled } onClick={ onSelect } role="radio" type="button">
      <span className="retrospective-choice-card-title">{ title }</span>
      <span className="retrospective-choice-card-description">{ description }</span>
      { disabled ? <span className="retrospective-choice-card-soon">Coming soon</span> : null }
    </button>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc The options screen.
// @param {object} props - An object with the following properties:
//   - {object|null} calendarCoverage - { coveredDays, totalDays } from the calendar journal, or null when unknown
//   - {Function} onChoose - Receives (style, options), options being { includeCalendar, includeImages, soundtrackVibe }
//   - {string} quarterLabel - Such as "Q3 2026"
// @returns {JSX.Element} The screen.
export default function RetrospectiveOptions({ calendarCoverage, onChoose, quarterLabel }) {
  const calendarAvailable = !!calendarCoverage?.coveredDays;
  const [includeCalendar, setIncludeCalendar] = useState(true);
  const [includeImages, setIncludeImages] = useState(true);
  const [style, setStyle] = useState(DEFAULT_RETROSPECTIVE_STYLE);
  const [soundtrackVibe, setSoundtrackVibe] = useState(DEFAULT_RETROSPECTIVE_SOUNDTRACK_VIBE);
  const styles = Object.values(RETROSPECTIVE_STYLES);
  const generate = () => onChoose(style, { includeCalendar: calendarAvailable && includeCalendar, includeImages, soundtrackVibe });

  return (
    <div className="retrospective-options">
      <p className="retrospective-options-kicker">Your quarter in review</p>
      <h2 className="retrospective-options-headline">{ `How should we tell ${ quarterLabel }?` }</h2>

      <h3 className="retrospective-options-section-title" id="retrospective-style-heading">Style</h3>
      <div aria-labelledby="retrospective-style-heading" className="retrospective-choice-cards" role="radiogroup">
        { styles.map(choice => (
          <ChoiceCard className={ `retrospective-style-card retrospective-style-card--${ choice }` } description={ STYLE_DESCRIPTIONS[choice] }
            disabled={ !AVAILABLE_RETROSPECTIVE_STYLES.includes(choice) } key={ choice } onSelect={ () => setStyle(choice) }
            selected={ style === choice } title={ retrospectiveStyleLabel(choice) } />
        )) }
      </div>

      <h3 className="retrospective-options-section-title" id="retrospective-vibe-heading">Soundtrack vibe</h3>
      <div aria-labelledby="retrospective-vibe-heading" className="retrospective-choice-cards retrospective-choice-cards--row" role="radiogroup">
        { SOUNDTRACK_VIBE_CHOICES.map(choice => (
          <ChoiceCard className={ `retrospective-vibe-card retrospective-vibe-card--${ choice.vibe }` } description={ choice.description }
            key={ choice.vibe } onSelect={ () => setSoundtrackVibe(choice.vibe) } selected={ soundtrackVibe === choice.vibe }
            title={ `${ choice.icon } ${ choice.label }` } />
        )) }
      </div>

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

      <button className="retrospective-options-generate" onClick={ generate } type="button">
        { `Generate ${ retrospectiveStyleLabel(style) } retrospective` }
      </button>
    </div>
  );
}
