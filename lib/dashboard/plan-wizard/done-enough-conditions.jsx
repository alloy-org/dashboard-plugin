// The card of mutually exclusive conditions on the "done enough" page. A day's bar is one rule rather than a
// set of them, so these are radios: choosing a second condition replaces the first instead of adding to it.
//
// "Not now" is one of the radios rather than an absent selection, because a user who has decided not to set a
// daily bar has made a choice, and the page should show that it heard it.
//
// The group is a labelled radiogroup rather than a fieldset and legend: a legend is laid out into the slot its
// fieldset's border passes through, which would cut a notch in the card edge this card draws.

import { DONE_ENOUGH_CONDITION_LEGEND, DONE_ENOUGH_CUSTOM_KEY,
  DONE_ENOUGH_OPTIONS } from "dashboard/plan-wizard/done-enough-fields";

const CONDITION_LEGEND_ID = "done-enough-conditions-legend";
const CUSTOM_CONDITION_PLACEHOLDER = "What has to be true before the day counts as a good one?";

// ----------------------------------------------------------------------------------------------
// @desc Render the condition choices and, when Custom condition is chosen, the field that describes it.
// @param {object} params - An object with the following properties:
//   - {string} conditionKey - Currently selected DONE_ENOUGH_OPTIONS key.
//   - {string} customConditionText - Text typed under Custom condition.
//   - {boolean} isDisabled - True while a save is in flight.
//   - {Function} onChangeCustom - Receives the custom condition text as it is typed.
//   - {Function} onSelectCondition - Receives the newly selected option key.
// @returns {JSX.Element} The conditions card.
export default function DoneEnoughConditions({ conditionKey, customConditionText, isDisabled, onChangeCustom,
    onSelectCondition }) {
  return (
    <div aria-labelledby={ CONDITION_LEGEND_ID } className="done-enough-conditions" role="radiogroup">
      <h3 className="done-enough-conditions-legend" id={ CONDITION_LEGEND_ID }>{ DONE_ENOUGH_CONDITION_LEGEND }</h3>
      { DONE_ENOUGH_OPTIONS.map(option => (
        <label className={ `done-enough-condition${ conditionKey === option.key ? " done-enough-condition--selected" : "" }` }
          key={ option.key }>
          <input checked={ conditionKey === option.key } className="done-enough-condition-radio" disabled={ isDisabled }
            name="done-enough-condition" onChange={ () => onSelectCondition(option.key) } type="radio"
            value={ option.key } />
          <span className="done-enough-condition-text">
            <span className="done-enough-condition-label">{ option.label }</span>
            { option.description ? <span className="done-enough-condition-description">{ option.description }</span> : null }
            { option.key === DONE_ENOUGH_CUSTOM_KEY && conditionKey === DONE_ENOUGH_CUSTOM_KEY ? (
              <input className="done-enough-custom-input" disabled={ isDisabled }
                onChange={ event => onChangeCustom(event.target.value) } placeholder={ CUSTOM_CONDITION_PLACEHOLDER }
                type="text" value={ customConditionText } />
            ) : null }
          </span>
        </label>
      )) }
    </div>
  );
}
