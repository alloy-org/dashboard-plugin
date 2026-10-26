// The Quarter Retrospective a past quarter's card opens. It always opens on the options screen, where the user picks a
// style and a soundtrack vibe and then plays that style's saved story or generates it. While a story plays, a header
// lists the other styles already generated, a mute button for the soundtrack, and a way back to the options; it always
// offers the quarter's plan note. The click that plays or generates a story is the gesture its soundtrack starts from.
import { SETTING_KEYS } from "constants/settings";
import RetrospectiveOptions from "dashboard/quarter-retrospective/retrospective-options";
import RetrospectiveOverlay from "dashboard/quarter-retrospective/retrospective-overlay";
import { retrospectiveStyleLabel } from "dashboard/quarter-retrospective/retrospective-data-note";
import { generateRetrospective, quarterCalendarCoverage, retrospectiveAiAvailable,
  savedRetrospectives } from "dashboard/quarter-retrospective/retrospective-generation";
import { createRetrospectiveAudioContext } from "dashboard/quarter-retrospective/retrospective-soundtrack";
import RetrospectiveStory from "dashboard/quarter-retrospective/retrospective-story";
import { pluginSettings, updatePluginSetting } from "plugin-data";
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "util/browser-utility";
import { navigateToNote } from "util/goal-notes";
import { logIfEnabled } from "util/log";

// ----------------------------------------------------------------------------------------------
// @desc Whether the soundtrack starts muted: as last chosen, or muted when the viewer asked for reduced motion.
// @returns {boolean} True to start muted.
function initialSoundtrackMuted() {
  const storedMuted = pluginSettings()[SETTING_KEYS.RETROSPECTIVE_SOUNDTRACK_MUTED];
  if (storedMuted === "true" || storedMuted === true) return true;
  if (storedMuted === "false" || storedMuted === false) return false;
  return prefersReducedMotion();
}

// ----------------------------------------------------------------------------------------------
// @desc The bar along the top of the card: the plan note link and, while a story plays, the other saved styles, a
//   soundtrack mute button when it has a soundtrack, and Options. Only what applies is shown.
// @param {object} props - An object with the following properties:
//   - {string|null} currentStyle - The style playing, or null when no story is playing
//   - {boolean} muted - Whether the soundtrack is muted
//   - {Function|null} onToggleMuted - Mutes or unmutes the soundtrack, or null when the story has none
//   - {Function} onShowOptions - Shows the options screen
//   - {Function|null} onOpenPlanNote - Opens the quarter's plan note, or null when the quarter has none
//   - {Function} onPlay - Receives a saved retrospective to play
//   - {Array<object>} saved - The quarter's saved retrospectives
// @returns {JSX.Element} The header.
function RetrospectiveHeader({ currentStyle, muted, onOpenPlanNote, onPlay, onShowOptions, onToggleMuted, saved }) {
  const otherSaved = currentStyle ? saved.filter(retrospective => retrospective.style !== currentStyle) : [];
  return (
    <div className="retrospective-overlay-header">
      { onToggleMuted ? (
        <button aria-pressed={ muted } className="retrospective-header-link retrospective-header-sound" onClick={ onToggleMuted } type="button">
          { muted ? "🔇 Sound off" : "🔊 Sound on" }
        </button>
      ) : null }
      { onOpenPlanNote ? <button className="retrospective-header-link" onClick={ onOpenPlanNote } type="button">Open plan note</button> : null }
      { otherSaved.map(retrospective => (
        <button className="retrospective-header-link" key={ retrospective.style } onClick={ () => onPlay(retrospective) } type="button">
          { `Play ${ retrospectiveStyleLabel(retrospective.style) }` }
        </button>
      )) }
      { currentStyle ? <button className="retrospective-header-link" onClick={ onShowOptions } type="button">Options</button> : null }
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
  const [aiAvailable, setAiAvailable] = useState(false);
  const [muted, setMuted] = useState(initialSoundtrackMuted);
  const audioContextRef = useRef(null);
  const scope = { domainName, quarter: plan.quarter, year: plan.year };

  useEffect(() => {
    let cancelled = false;
    Promise.all([savedRetrospectives(app, scope).catch(error => {
      logIfEnabled("[quarter-retrospective] could not read saved retrospectives", error?.message);
      return [];
    }), quarterCalendarCoverage(app, scope), retrospectiveAiAvailable(app)]).then(([savedList, coverage, aiFound]) => {
      if (cancelled) return;
      setSaved(savedList);
      setCalendarCoverage(coverage);
      setAiAvailable(aiFound);
      setView({ kind: "options" });
    });
    return () => { cancelled = true; };
  }, [app, domainName, plan.quarter, plan.year]);

  useEffect(() => () => {
    audioContextRef.current?.close?.()?.catch?.(() => {});
    audioContextRef.current = null;
  }, []);

  // @desc Make the soundtrack's audio context the first time a story is played or generated. It must run inside that
  //   click, before anything awaits, for the browser to let it start.
  const prepareSoundtrack = () => {
    if (!audioContextRef.current) audioContextRef.current = createRetrospectiveAudioContext();
  };
  // @desc Mute or unmute the soundtrack, remembering the choice for later retrospectives.
  const toggleMuted = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    updatePluginSetting(SETTING_KEYS.RETROSPECTIVE_SOUNDTRACK_MUTED, String(nextMuted));
    Promise.resolve().then(() => app.setSetting(SETTING_KEYS.RETROSPECTIVE_SOUNDTRACK_MUTED, String(nextMuted))).catch(error => {
      logIfEnabled("[quarter-retrospective] could not save the soundtrack mute", error?.message);
    });
  };

  // @desc Generate a style and play it, replacing any saved retrospective of the same style in the header's list. The
  //   status screen names each step of the generation as it starts. The story keeps the soundtrack vibe chosen for it.
  const handleGenerate = async (style, options) => {
    prepareSoundtrack();
    setView({ kind: "generating", message: `Reading ${ plan.label }'s completed tasks…` });
    const onProgress = message => setView(previous => (previous.kind === "generating" ? { ...previous, message } : previous));
    try {
      const retrospective = await generateRetrospective(app, { ...scope, domainUuid, options, style }, { onProgress });
      setSaved(previous => [retrospective, ...previous.filter(existing => existing.style !== style)]);
      setView({ kind: "story", retrospective, soundtrackVibe: options.soundtrackVibe });
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
  // @desc Play a saved story with the soundtrack vibe chosen on the options screen, or the one already playing.
  const playSaved = (retrospective, soundtrackVibe = view.soundtrackVibe) => {
    prepareSoundtrack();
    setView({ kind: "story", retrospective, soundtrackVibe });
  };

  let body;
  if (view.kind === "loading") body = <RetrospectiveStatus message={ `Looking for ${ plan.label } retrospectives…` } />;
  else if (view.kind === "generating") body = <RetrospectiveStatus message={ view.message } />;
  else if (view.kind === "error") body = <RetrospectiveStatus message={ view.message } onRetry={ showOptions } />;
  else if (view.kind === "options") {
    body = <RetrospectiveOptions aiAvailable={ aiAvailable } calendarCoverage={ calendarCoverage } onGenerate={ handleGenerate } onPlay={ playSaved }
      quarterLabel={ plan.label } saved={ saved } />;
  } else {
    body = <RetrospectiveStory audioContext={ audioContextRef.current } key={ view.retrospective.generatedAt }
      label={ `${ plan.label } retrospective` } muted={ muted } slides={ view.retrospective.slides } soundtrackVibe={ view.soundtrackVibe || null } />;
  }
  const currentStyle = view.kind === "story" ? view.retrospective.style : null;
  const storyHasSoundtrack = view.kind === "story" && !!audioContextRef.current && !!view.soundtrackVibe;

  return (
    <RetrospectiveOverlay label={ `${ plan.label } retrospective` } onClose={ onClose }>
      <RetrospectiveHeader currentStyle={ currentStyle } muted={ muted } onOpenPlanNote={ openPlanNote }
        onPlay={ retrospective => playSaved(retrospective) } onShowOptions={ showOptions } onToggleMuted={ storyHasSoundtrack ? toggleMuted : null }
        saved={ saved } />
      { body }
    </RetrospectiveOverlay>
  );
}
