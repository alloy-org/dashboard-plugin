// The Quarter Retrospective a past quarter's card opens: it plays the quarter's most recently generated retrospective,
// or shows the options screen when none has been generated. A header names the style playing, lists the other styles
// already generated, and offers to generate a new one or open the quarter's plan note.
import RetrospectiveOptions from "dashboard/quarter-retrospective/retrospective-options";
import RetrospectiveOverlay from "dashboard/quarter-retrospective/retrospective-overlay";
import { retrospectiveStyleLabel } from "dashboard/quarter-retrospective/retrospective-data-note";
import { generateRetrospective, quarterCalendarCoverage,
  savedRetrospectives } from "dashboard/quarter-retrospective/retrospective-generation";
import RetrospectiveStory from "dashboard/quarter-retrospective/retrospective-story";
import { useEffect, useState } from "react";
import { navigateToNote } from "util/goal-notes";
import { logIfEnabled } from "util/log";

// ----------------------------------------------------------------------------------------------
// @desc The bar along the top of the card: the plan note link, the style playing, the other saved styles, and
//   Generate new. Only what applies is shown.
// @param {object} props - An object with the following properties:
//   - {string|null} currentStyle - The style playing, or null when no story is playing
//   - {Function} onGenerateNew - Shows the options screen
//   - {Function|null} onOpenPlanNote - Opens the quarter's plan note, or null when the quarter has none
//   - {Function} onPlay - Receives a saved retrospective to play
//   - {Array<object>} saved - The quarter's saved retrospectives
// @returns {JSX.Element} The header.
function RetrospectiveHeader({ currentStyle, onGenerateNew, onOpenPlanNote, onPlay, saved }) {
  const otherSaved = saved.filter(retrospective => retrospective.style !== currentStyle);
  return (
    <div className="retrospective-overlay-header">
      { onOpenPlanNote ? <button className="retrospective-header-link" onClick={ onOpenPlanNote } type="button">Open plan note</button> : null }
      { otherSaved.map(retrospective => (
        <button className="retrospective-header-link" key={ retrospective.style } onClick={ () => onPlay(retrospective) } type="button">
          { `Play ${ retrospectiveStyleLabel(retrospective.style) }` }
        </button>
      )) }
      { currentStyle ? <button className="retrospective-header-link" onClick={ onGenerateNew } type="button">Generate new</button> : null }
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc The screen shown while the quarter is read or a retrospective is generated, or after either fails.
// @param {object} props - { message, onRetry }: onRetry, when given, shows a button that goes back to the options.
// @returns {JSX.Element} The status screen.
function RetrospectiveStatus({ message, onRetry = null }) {
  return (
    <div className="retrospective-status" role="status">
      <p className="retrospective-status-message">{ message }</p>
      { onRetry ? <button className="retrospective-story-control" onClick={ onRetry } type="button">Back to styles</button> : null }
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc The retrospective for one past quarter of one task domain.
// @param {object} props - An object with the following properties:
//   - {object} app - Amplenote app bridge
//   - {string} domainName - Task domain display name, "All Notes" without a domain
//   - {string|null} domainUuid - Task domain UUID
//   - {Function} onClose - Closes the retrospective
//   - {object} plan - The quarter's card plan: { label, noteUUID, quarter, year }
// @returns {JSX.Element} The overlay.
export default function QuarterRetrospective({ app, domainName, domainUuid, onClose, plan }) {
  const [view, setView] = useState({ kind: "loading" });
  const [saved, setSaved] = useState([]);
  const [calendarCoverage, setCalendarCoverage] = useState(null);
  const scope = { domainName, quarter: plan.quarter, year: plan.year };

  useEffect(() => {
    let cancelled = false;
    Promise.all([savedRetrospectives(app, scope).catch(error => {
      logIfEnabled("[quarter-retrospective] could not read saved retrospectives", error?.message);
      return [];
    }), quarterCalendarCoverage(app, scope)]).then(([savedList, coverage]) => {
      if (cancelled) return;
      setSaved(savedList);
      setCalendarCoverage(coverage);
      setView(savedList.length ? { kind: "story", retrospective: savedList[0] } : { kind: "options" });
    });
    return () => { cancelled = true; };
  }, [app, domainName, plan.quarter, plan.year]);

  // @desc Generate a style and play it, replacing any saved retrospective of the same style in the header's list. The
  //   status screen names each step of the generation as it starts.
  const handleChoose = async (style, options) => {
    setView({ kind: "generating", message: `Reading ${ plan.label }'s completed tasks…` });
    const onProgress = message => setView(previous => (previous.kind === "generating" ? { ...previous, message } : previous));
    try {
      const retrospective = await generateRetrospective(app, { ...scope, domainUuid, options, style }, { onProgress });
      setSaved(previous => [retrospective, ...previous.filter(existing => existing.style !== style)]);
      setView({ kind: "story", retrospective });
    } catch (error) {
      logIfEnabled("[quarter-retrospective] could not generate", error?.message);
      setView({ kind: "error", message: `Couldn't build the retrospective: ${ error?.message || "unknown error" }` });
    }
  };
  const openPlanNote = plan.noteUUID ? () => {
    onClose();
    navigateToNote(app, plan.noteUUID);
  } : null;
  const showOptions = () => setView({ kind: "options" });

  let body;
  if (view.kind === "loading") body = <RetrospectiveStatus message={ `Looking for ${ plan.label } retrospectives…` } />;
  else if (view.kind === "generating") body = <RetrospectiveStatus message={ view.message } />;
  else if (view.kind === "error") body = <RetrospectiveStatus message={ view.message } onRetry={ showOptions } />;
  else if (view.kind === "options") {
    body = <RetrospectiveOptions calendarCoverage={ calendarCoverage } onChoose={ handleChoose } quarterLabel={ plan.label } />;
  } else {
    body = <RetrospectiveStory key={ view.retrospective.generatedAt } label={ `${ plan.label } retrospective` }
      slides={ view.retrospective.slides } />;
  }
  const currentStyle = view.kind === "story" ? view.retrospective.style : null;

  return (
    <RetrospectiveOverlay label={ `${ plan.label } retrospective` } onClose={ onClose }>
      <RetrospectiveHeader currentStyle={ currentStyle } onGenerateNew={ showOptions } onOpenPlanNote={ openPlanNote }
        onPlay={ retrospective => setView({ kind: "story", retrospective }) } saved={ saved } />
      { body }
    </RetrospectiveOverlay>
  );
}
