// The Quarter Retrospective's options screen, shown every time the retrospective opens: a card per style and a card per
// soundtrack vibe, one of each chosen from the start, the calendar toggle when the journal recorded any of this quarter,
// an "Advanced options" link revealing the images toggle and the tag every note the retrospective writes is given
// (suggested from the tags on the user's planning notes), and a button that plays the chosen style's saved story
// or generates it. A saved story told from no completed tasks has nothing to show, so it is offered for generating
// again rather than playing when it can be. A style the AI writes can be chosen only when an AI is available or its story was saved. The
// button's click is the gesture a later phase starts music from.
import { AI_WRITTEN_RETROSPECTIVE_STYLES, AVAILABLE_RETROSPECTIVE_STYLES, DEFAULT_RETROSPECTIVE_SOUNDTRACK_VIBE, DEFAULT_RETROSPECTIVE_STYLE,
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
  { description: "Retro synths with a steady drive.", icon: "🌆", label: "Synth", vibe: RETROSPECTIVE_SOUNDTRACK_VIBES.synthwave },
  { description: "Big, bright, and triumphant.", icon: "🏆", label: "Anthem", vibe: RETROSPECTIVE_SOUNDTRACK_VIBES.anthem },
]);

// ----------------------------------------------------------------------------------------------
// @desc One selectable card in a group where exactly one is chosen. A card that can't be chosen is shown disabled, with
//   a note saying why.
// @param {object} props - An object with the following properties:
//   - {string} className - The card's modifier classes
//   - {string} description - One line under the title
//   - {boolean} [disabled] - Whether it can't be chosen
//   - {string|null} [note] - A short status line, such as when its story was saved or why it can't be chosen
//   - {Function} onSelect - Chooses the card
//   - {boolean} selected - Whether it is the group's choice
//   - {string} title - The card's name
// @returns {JSX.Element} The card.
function ChoiceCard({ className, description, disabled = false, note = null, onSelect, selected, title }) {
  return (
    <button aria-checked={ selected } className={ `retrospective-choice-card ${ className }${ selected ? " retrospective-choice-card--selected" : "" }` }
      disabled={ disabled } onClick={ onSelect } role="radio" type="button">
      <span className="retrospective-choice-card-title">{ title }</span>
      <span className="retrospective-choice-card-description">{ description }</span>
      { note ? <span className="retrospective-choice-card-note">{ note }</span> : null }
    </button>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Why a style's card can't be chosen, or when its story was saved and whether it was told from no tasks.
// @param {object} options - { aiAvailable, savedRetrospective, style }.
// @returns {object} { disabled, note }.
function styleCardState({ aiAvailable, savedRetrospective, style }) {
  if (!AVAILABLE_RETROSPECTIVE_STYLES.includes(style)) return { disabled: true, note: "Coming soon" };
  if (savedRetrospective) {
    const savedDate = new Date(savedRetrospective.generatedAt);
    const savedLabel = Number.isFinite(savedDate.getTime()) ? savedDate.toLocaleDateString("en-US", { day: "numeric", month: "short" }) : null;
    const savedNote = savedLabel ? `Saved ${ savedLabel }` : "Saved";
    return { disabled: false, note: savedRetrospective.totalTaskCount === 0 ? `${ savedNote }, with no tasks` : savedNote };
  }
  if (AI_WRITTEN_RETROSPECTIVE_STYLES.includes(style) && !aiAvailable) return { disabled: true, note: "Needs an AI provider (Dashboard Settings)" };
  return { disabled: false, note: null };
}

// ----------------------------------------------------------------------------------------------
// @desc The style chosen when the screen opens: the most recently saved one, else the default when it can be chosen,
//   else Data.
// @param {object} options - { aiAvailable, saved }.
// @returns {string} A RETROSPECTIVE_STYLES value.
function initialStyle({ aiAvailable, saved }) {
  if (saved.length) return saved[0].style;
  const defaultState = styleCardState({ aiAvailable, savedRetrospective: null, style: DEFAULT_RETROSPECTIVE_STYLE });
  return defaultState.disabled ? RETROSPECTIVE_STYLES.data : DEFAULT_RETROSPECTIVE_STYLE;
}

// ----------------------------------------------------------------------------------------------
// @desc The options screen.
// @param {object} props - An object with the following properties:
//   - {boolean} aiAvailable - Whether an AI can write the Roast and Spotify styles
//   - {object|null} calendarCoverage - { coveredDays, totalDays } from the calendar journal, or null when unknown
//   - {string} initialNoteTag - The tag retrospective notes are given, as last chosen
//   - {Function} onGenerate - Receives (style, options), options being { includeCalendar, includeImages, noteTag,
//     soundtrackVibe }
//   - {Function} onPlay - Receives (retrospective, soundtrackVibe, noteTag) to play a saved story
//   - {string} quarterLabel - Such as "Q3 2026"; the headline names only its quarter, so it fits on one line
//   - {Array<object>} saved - The quarter's saved retrospectives, newest first
//   - {Array<string>} [tagSuggestions] - Tags offered as the note tag is typed
// @returns {JSX.Element} The screen.
export default function RetrospectiveOptions({ aiAvailable, calendarCoverage, initialNoteTag, onGenerate, onPlay, quarterLabel, saved,
    tagSuggestions = [] }) {
  const calendarAvailable = !!calendarCoverage?.coveredDays;
  const [includeCalendar, setIncludeCalendar] = useState(true);
  const [includeImages, setIncludeImages] = useState(true);
  const [style, setStyle] = useState(() => initialStyle({ aiAvailable, saved }));
  const [soundtrackVibe, setSoundtrackVibe] = useState(DEFAULT_RETROSPECTIVE_SOUNDTRACK_VIBE);
  const [noteTag, setNoteTag] = useState(initialNoteTag);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const quarterName = quarterLabel.split(" ")[0];
  const styles = Object.values(RETROSPECTIVE_STYLES);
  const savedByStyle = new Map(saved.map(retrospective => [retrospective.style, retrospective]));
  const chosenSaved = savedByStyle.get(style) || null;
  const chosenLabel = retrospectiveStyleLabel(style);
  const canGenerate = AVAILABLE_RETROSPECTIVE_STYLES.includes(style) && (aiAvailable || !AI_WRITTEN_RETROSPECTIVE_STYLES.includes(style));
  const playableSaved = chosenSaved && !(chosenSaved.totalTaskCount === 0 && canGenerate) ? chosenSaved : null;
  const generateLabel = chosenSaved ? `Generate a new ${ chosenLabel } retrospective` : `Generate ${ chosenLabel } retrospective`;
  const generate = () => onGenerate(style, { includeCalendar: calendarAvailable && includeCalendar, includeImages, noteTag, soundtrackVibe });

  return (
    <div className="retrospective-options">
      <p className="retrospective-options-kicker">Your quarter in review</p>
      <h2 className="retrospective-options-headline">{ `Craft your ${ quarterName } retrospective` }</h2>

      <h3 className="retrospective-options-section-title" id="retrospective-style-heading">Style</h3>
      <div aria-labelledby="retrospective-style-heading" className="retrospective-choice-cards" role="radiogroup">
        { styles.map(choice => {
          const { disabled, note } = styleCardState({ aiAvailable, savedRetrospective: savedByStyle.get(choice) || null, style: choice });
          return (
            <ChoiceCard className={ `retrospective-style-card retrospective-style-card--${ choice }` } description={ STYLE_DESCRIPTIONS[choice] }
              disabled={ disabled } key={ choice } note={ note } onSelect={ () => setStyle(choice) } selected={ style === choice }
              title={ retrospectiveStyleLabel(choice) } />
          );
        }) }
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
      { showAdvanced ? (
        <>
          <label className="retrospective-options-toggle">
            <input checked={ includeImages } onChange={ event => setIncludeImages(event.target.checked) } type="checkbox" />
            <span>Show images from my notes, when any fit (Roast and Spotify)</span>
          </label>

          <label className="retrospective-options-tag-picker">
            <span className="retrospective-options-section-title">Tag for retrospective notes</span>
            <input className="retrospective-options-tag-input" list="retrospective-tag-suggestions" onChange={ event => setNoteTag(event.target.value) }
              placeholder={ initialNoteTag } spellCheck={ false } type="text" value={ noteTag } />
            <span className="retrospective-options-tag-hint">Given to the takeaways note, each "Document how you did it" note, and the archived data notes.</span>
          </label>
          <datalist id="retrospective-tag-suggestions">
            { tagSuggestions.map(suggestion => <option key={ suggestion } value={ suggestion } />) }
          </datalist>
        </>
      ) : (
        <button className="retrospective-options-advanced-link" onClick={ () => setShowAdvanced(true) } type="button">Advanced options</button>
      ) }

      <div className="retrospective-options-actions">
        { playableSaved ? (
          <button className="retrospective-options-primary" onClick={ () => onPlay(playableSaved, soundtrackVibe, noteTag) } type="button">
            { `Play ${ chosenLabel } retrospective` }
          </button>
        ) : (
          <button className="retrospective-options-primary" disabled={ !canGenerate } onClick={ generate } type="button">
            { generateLabel }
          </button>
        ) }
        { playableSaved && canGenerate ? (
          <button className="retrospective-options-secondary" onClick={ generate } type="button">{ `Generate a new ${ chosenLabel } one` }</button>
        ) : null }
      </div>
    </div>
  );
}
