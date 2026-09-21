// Plan Builder's side page showing how the intent page's suggestions were drawn from the user's notes: the notes and
// tasks that were read, the themes found in them, and the directions inferred from those themes. It is revealed in
// that order, a step at a time, so the page reads as the reasoning it describes rather than as a finished report.
// Pinning or dismissing a theme is stored in the Vision Guide and steers the next reading, which is how the user
// shapes what Plan Builder sends to the model without editing that data note by hand.

import { themeKey } from "plan-wizard/intent-reading";
import { useEffect, useRef, useState } from "react";

const READ_ITEM_REVEAL_MS = 90;
const THEME_REVEAL_MS = 220;
const DIRECTION_REVEAL_MS = 320;
const STATUS_TEXT = { inferring: "Looking for themes and directions…", reading: "Reading your notes…",
  ready: "Ready. Pick a direction or write your own." };

// ----------------------------------------------------------------------------------------------
// @desc Count up to itemCount one item per interval once enabled, so a list appears item by item instead of all at
//   once. The count never falls below what is already shown when the list grows, and resets when it shrinks.
// @param {number} itemCount - Items available to reveal.
// @param {boolean} isEnabled - False holds the count at zero until the earlier part of the page has finished.
// @param {number} intervalMs - Delay between items.
// @returns {number} How many items to show.
// Under reduced motion the whole list is shown at once, since the staggering is decoration rather than information.
function useStaggeredReveal(itemCount, isEnabled, intervalMs) {
  const [revealedCount, setRevealedCount] = useState(0);
  const prefersReducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!isEnabled) {
      setRevealedCount(0);
      return undefined;
    }
    if (prefersReducedMotion) {
      setRevealedCount(itemCount);
      return undefined;
    }
    setRevealedCount(previous => Math.min(previous, itemCount));
    const intervalId = setInterval(() => {
      setRevealedCount(previous => {
        if (previous >= itemCount) clearInterval(intervalId);
        return Math.min(previous + 1, itemCount);
      });
    }, intervalMs);
    return () => clearInterval(intervalId);
  }, [intervalMs, isEnabled, itemCount, prefersReducedMotion]);

  return Math.min(revealedCount, itemCount);
}

// ----------------------------------------------------------------------------------------------
// @desc Render the thin bar that fills while the notes are being read. Shared by the intent page's link and this
//   page's header, so both show the same elapsed fill rather than each restarting its own.
// @param {object} params - An object with the following properties:
//   - {number} fraction - Fill between 0 and 1.
// @returns {JSX.Element} The bar.
export function IntentReadingProgressBar({ fraction }) {
  return (
    <div aria-hidden="true" className="intent-reading-progress-track">
      <div className="intent-reading-progress-fill" style={ { width: `${ Math.round(fraction * 100) }%` } } />
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Draw the icon beside a read item: a page for a note, a ticked box for a task.
// @param {object} params - An object with the following properties:
//   - {string} kind - note or task.
// @returns {JSX.Element} Inline SVG.
function ReadItemIcon({ kind }) {
  if (kind === "task") {
    return (
      <svg aria-hidden="true" className="intent-reading-item-icon" viewBox="0 0 16 16">
        <rect height="11" rx="2" width="11" x="2.5" y="2.5" />
        <path d="M5.5 8.2l1.8 1.8 3.4-3.6" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="intent-reading-item-icon" viewBox="0 0 16 16">
      <path d="M4 1.5h5.5l3 3v10H4z" />
      <path d="M6 7.5h4.5M6 10h4.5" />
    </svg>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc One theme with its task count and the controls that pin or dismiss it. A second press on the active control
//   clears the judgement, so a mistaken pin or dismissal is undone where it was made.
// @param {object} params - An object with the following properties:
//   - {string|null} judgement - pinned, dismissed, or null.
//   - {boolean} isSaving - True while this theme's judgement is being written.
//   - {Function} onJudge - Receives pinned, dismissed, or null.
//   - {object} theme - { label, taskCount }.
// @returns {JSX.Element} The theme row.
function IntentReadingTheme({ isSaving, judgement, onJudge, theme }) {
  const isPinned = judgement === "pinned";
  const isDismissed = judgement === "dismissed";
  const themeClass = `intent-reading-theme${ isPinned ? " intent-reading-theme--pinned" : "" }${ isDismissed ? " intent-reading-theme--dismissed" : "" }`;
  return (
    <li className={ themeClass }>
      <span className="intent-reading-theme-label">{ theme.label }</span>
      { theme.taskCount ? <span className="intent-reading-theme-count">{ theme.taskCount }</span> : null }
      <button aria-label={ `${ isPinned ? "Unpin" : "Pin" } ${ theme.label }` } aria-pressed={ isPinned }
        className="intent-reading-theme-button" disabled={ isSaving } onClick={ () => onJudge(isPinned ? null : "pinned") }
        title={ isPinned ? "Pinned: favored in the next reading" : "Pin: this matters" } type="button">
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M6 2h4l-.6 4 2.6 2.5v1H4v-1L6.6 6z" />
          <path d="M8 9.5V14" />
        </svg>
      </button>
      <button aria-label={ `${ isDismissed ? "Restore" : "Dismiss" } ${ theme.label }` } aria-pressed={ isDismissed }
        className="intent-reading-theme-button" disabled={ isSaving } onClick={ () => onJudge(isDismissed ? null : "dismissed") }
        title={ isDismissed ? "Dismissed: left out of the next reading" : "Dismiss: this doesn't matter" } type="button">
        ×
      </button>
    </li>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render the reading page.
// @param {object} params - An object with the following properties:
//   - {Array<object>} directions - The professional IntentPossibility records inferred from this reading.
//   - {object} intentReading - { phase, readItems, themeJudgements, themes } from usePlanWizard.
//   - {boolean} isRefreshing - True while a reading is running.
//   - {Function} onApplyDirection - Receives a direction to place in the intent page's field, then returns there.
//   - {Function} onJudgeTheme - Receives (label, judgement) and resolves once the judgement is stored.
//   - {Function} onReread - Starts a new reading, which applies the stored theme judgements.
//   - {Function} onReturn - Goes back to the intent page.
//   - {number} progressFraction - Elapsed fill of the running reading.
// @returns {JSX.Element} The page.
// Directions span the full width beneath the two columns: they are the page's conclusion and the one thing on it the
//   user acts on, so they are not squeezed under the themes.
export default function IntentReadingPage({ directions, intentReading, isRefreshing, onApplyDirection, onJudgeTheme,
    onReread, onReturn, progressFraction }) {
  const { phase, readItems, themeJudgements, themes } = intentReading;
  const [savingThemeKeys, setSavingThemeKeys] = useState(() => new Set());
  const openedJudgementsRef = useRef(JSON.stringify(themeJudgements));
  const isReady = phase === "ready" && !isRefreshing;
  const revealedReadCount = useStaggeredReveal(readItems.length, phase !== "reading", READ_ITEM_REVEAL_MS);
  const hasRevealedReadItems = revealedReadCount >= readItems.length;
  const revealedThemeCount = useStaggeredReveal(themes.length, isReady && hasRevealedReadItems, THEME_REVEAL_MS);
  const hasRevealedThemes = revealedThemeCount >= themes.length;
  const revealedDirectionCount = useStaggeredReveal(directions.length, isReady && hasRevealedReadItems && hasRevealedThemes,
    DIRECTION_REVEAL_MS);
  const hasChangedJudgements = JSON.stringify(themeJudgements) !== openedJudgementsRef.current;
  const hasStoredReading = readItems.length > 0 || themes.length > 0;

  useEffect(() => {
    if (isRefreshing) openedJudgementsRef.current = JSON.stringify(themeJudgements);
  }, [isRefreshing]);

  // ----------------------------------------------------------------------------------------------
  // @desc Store a theme's judgement, disabling that theme's controls until the write settles.
  // @param {object} theme - { label, taskCount }.
  // @param {string|null} judgement - pinned, dismissed, or null.
  const handleJudgeTheme = async (theme, judgement) => {
    setSavingThemeKeys(previous => new Set(previous).add(theme.label));
    try {
      await onJudgeTheme(theme.label, judgement);
    } finally {
      setSavingThemeKeys(previous => {
        const remaining = new Set(previous);
        remaining.delete(theme.label);
        return remaining;
      });
    }
  };

  const visibleReadItems = readItems.slice(0, revealedReadCount);
  const visibleThemes = themes.slice(0, revealedThemeCount);
  const visibleDirections = directions.slice(0, revealedDirectionCount);
  const statusText = isRefreshing ? STATUS_TEXT[phase] ?? STATUS_TEXT.reading : STATUS_TEXT.ready;

  return (
    <section aria-label="How your notes were read" className="plan-step-container intent-reading-page">
      <header className="intent-reading-header">
        <h2 className="plan-heading intent-reading-title">Reading your last quarter</h2>
        <button className="intent-reading-return" onClick={ onReturn } type="button">Return to Plan Builder</button>
      </header>
      <IntentReadingProgressBar fraction={ isReady ? 1 : progressFraction } />
      <p className="intent-reading-status" role="status">
        { !isRefreshing && !hasStoredReading ? "No reading is stored for this quarter yet." : statusText }
      </p>
      <div className="intent-reading-columns">
        <section className="intent-reading-column">
          <h3 className="intent-reading-section-heading">
            Read{ readItems.length ? <span className="intent-reading-section-count">{ ` ${ readItems.length }` }</span> : null }
          </h3>
          { visibleReadItems.length ? (
            <ul className="intent-reading-read-list">
              { visibleReadItems.map(item => (
                <li className="intent-reading-read-item" key={ `${ item.kind }:${ item.taskUuid ?? item.noteUuid }:${ item.label }` }>
                  <ReadItemIcon kind={ item.kind } />
                  <span className="intent-reading-read-label">{ item.label }</span>
                </li>
              )) }
            </ul>
          ) : (
            <p className="intent-reading-placeholder">{ isRefreshing ? "Gathering recent notes and tasks…" : "Nothing read yet." }</p>
          ) }
        </section>
        <section className="intent-reading-column">
          <h3 className="intent-reading-section-heading">
            Themes showing up <span className="intent-reading-section-hint">· pin what matters, dismiss what doesn't</span>
          </h3>
          { visibleThemes.length ? (
            <ul className="intent-reading-theme-list">
              { visibleThemes.map(theme => (
                <IntentReadingTheme isSaving={ savingThemeKeys.has(theme.label) } key={ theme.label }
                  judgement={ themeJudgements[themeKey(theme.label)]?.judgement ?? null }
                  onJudge={ judgement => handleJudgeTheme(theme, judgement) } theme={ theme } />
              )) }
            </ul>
          ) : null }
          { !visibleThemes.length && !(isReady && themes.length) ? (
            <p className="intent-reading-placeholder">
              { isReady ? "No recurring themes were reported." : "Themes appear once the notes are read." }
            </p>
          ) : null }
          { isReady && hasChangedJudgements ? (
            <button className="plan-button plan-button--dashed intent-reading-reread" onClick={ onReread } type="button">
              Read again with these themes
            </button>
          ) : null }
        </section>
      </div>
      <section className="intent-reading-directions">
        <h3 className="intent-reading-section-heading">
          Directions{ isReady && directions.length ? ` (${ revealedDirectionCount } of ${ directions.length })` : "" }
        </h3>
        { visibleDirections.length ? (
          <ul className="intent-reading-direction-list">
            { visibleDirections.map(direction => (
              <li key={ direction.uuid }>
                <button className="intent-reading-direction" onClick={ () => onApplyDirection(direction) }
                  title={ direction.substantiation } type="button">
                  <svg aria-hidden="true" className="intent-reading-direction-icon" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="8" />
                    <circle cx="12" cy="12" r="4" />
                    <circle className="intent-reading-direction-icon-center" cx="12" cy="12" r="1.5" />
                  </svg>
                  <span>{ direction.intent }</span>
                </button>
              </li>
            )) }
          </ul>
        ) : null }
        { !visibleDirections.length && !(isReady && directions.length) ? (
          <p className="intent-reading-placeholder">
            { isReady ? "No directions were inferred." : "Directions are drawn from the themes." }
          </p>
        ) : null }
      </section>
    </section>
  );
}
