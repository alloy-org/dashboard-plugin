// Play the Quarter Retrospective's slides as a story: a segmented progress bar across the top, each slide advancing
// on its own after a few seconds, a tap on the left or right side stepping back or ahead, pressing and holding to
// pause, and the arrow keys and Space doing the same from the keyboard. A Pause button in the footer, a hint beside it on
// the first slide, and a badge there while paused make pausing easy to find. The story stops on its last slide. Given an
// audio context and a soundtrack vibe, it plays that vibe's loop, pausing with the story and fading out at its end.
// Given a background photo seed, each slide blends an abstract photo behind its words, the next slide's photo loading
// while the current one shows. A slide the caller renders as interactive, such as the payoff ranking, waits for the
// user: its clock doesn't run, the tap zones and hold-to-pause step aside so its controls can be used, and it moves
// on when the caller's controls say it's done. An interactive last slide, the end card, counts as the story's end: the
// soundtrack fades out on reaching it, and its own controls offer Replay in place of the footer's.
import RetrospectiveSlide from "dashboard/quarter-retrospective/retrospective-slide";
import { slideDurationFactor } from "dashboard/quarter-retrospective/retrospective-slides";
import { RetrospectiveSoundtrack } from "dashboard/quarter-retrospective/retrospective-soundtrack";
import { useEffect, useRef, useState } from "react";
import { retrospectiveBackgroundUrl } from "util/background-splash-images";

export const SLIDE_MILLISECONDS = 7200;
export const STORY_TICK_MILLISECONDS = 50;
// A press held longer than this pauses the story rather than counting as a tap.
export const HOLD_MILLISECONDS = 250;

// ----------------------------------------------------------------------------------------------
// @desc One progress segment: full for slides already seen, filling for the current one, empty for the rest.
// @param {object} props - { fill } between 0 and 1.
// @returns {JSX.Element} The segment.
function ProgressSegment({ fill }) {
  return (
    <span className="retrospective-story-segment">
      <span className="retrospective-story-segment-fill" style={{ transform: `scaleX(${ fill })` }} />
    </span>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Run the current slide's clock while the story plays, and move to the next slide once it runs out.
// @param {object} options - { elapsed, index, paused, setElapsed, showSlide, slideCount, slideMilliseconds }, showSlide
//   being the one way to change slides, since it restarts the clock in the same update.
function useStoryClock({ elapsed, index, paused, setElapsed, showSlide, slideCount, slideMilliseconds }) {
  useEffect(() => {
    if (paused) return undefined;
    const intervalId = setInterval(() => {
      setElapsed(previous => Math.min(slideMilliseconds, previous + STORY_TICK_MILLISECONDS));
    }, STORY_TICK_MILLISECONDS);
    return () => clearInterval(intervalId);
  }, [index, paused, slideMilliseconds]);

  useEffect(() => {
    if (elapsed >= slideMilliseconds && index < slideCount - 1) showSlide(index + 1);
  }, [elapsed, index, slideCount, slideMilliseconds]);
}

// ----------------------------------------------------------------------------------------------
// @desc Start loading the next slide's background photo while the current slide shows, so it is ready when the slide
//   enters rather than fading in late.
// @param {object} options - { backgroundPhotoSeed, index, slideCount }: no seed loads nothing.
function usePreloadedBackgroundPhoto({ backgroundPhotoSeed, index, slideCount }) {
  useEffect(() => {
    if (!backgroundPhotoSeed || index + 1 >= slideCount || typeof Image !== "function") return;
    const preloadedImage = new Image();
    preloadedImage.src = retrospectiveBackgroundUrl(backgroundPhotoSeed, index + 1);
  }, [backgroundPhotoSeed, index, slideCount]);
}

// ----------------------------------------------------------------------------------------------
// @desc Play the soundtrack for as long as the story is open: it pauses while the user has paused the story, fades out
//   once the last slide ends, and starts again on Replay. Holding to pause leaves it playing, so a hold doesn't stutter.
// @param {object} options - An object with the following properties:
//   - {AudioContext|null} audioContext - Where the loop plays; null plays nothing
//   - {boolean} finished - Whether the last slide has ended
//   - {boolean} muted - Whether the loop is silenced
//   - {number} slideMilliseconds - One slide's length, which sets the tempo
//   - {string|null} soundtrackVibe - A RETROSPECTIVE_SOUNDTRACK_VIBES value; null plays nothing
//   - {boolean} userPaused - Whether the user paused the story
function useStorySoundtrack({ audioContext, finished, muted, slideMilliseconds, soundtrackVibe, userPaused }) {
  const soundtrackRef = useRef(null);

  useEffect(() => {
    if (!audioContext || !soundtrackVibe) return undefined;
    const soundtrack = new RetrospectiveSoundtrack({ audioContext, muted, slideMilliseconds, vibe: soundtrackVibe });
    soundtrackRef.current = soundtrack;
    return () => {
      soundtrack.stop();
      soundtrackRef.current = null;
    };
  }, [audioContext, slideMilliseconds, soundtrackVibe]);

  useEffect(() => {
    const soundtrack = soundtrackRef.current;
    if (!soundtrack) return;
    if (finished) soundtrack.fadeOut();
    else if (userPaused) soundtrack.pause();
    else soundtrack.play();
  }, [audioContext, finished, slideMilliseconds, soundtrackVibe, userPaused]);

  useEffect(() => {
    soundtrackRef.current?.setMuted(muted);
  }, [muted]);
}

// ----------------------------------------------------------------------------------------------
// @desc The story player.
// @param {object} props - An object with the following properties:
//   - {AudioContext|null} [audioContext] - Where the soundtrack plays, made from a user's click; none plays no soundtrack
//   - {string|null} [backgroundPhotoSeed] - Picks the abstract photos behind the slides, stable per story; none shows
//     no photos
//   - {string} label - Accessible name for the story, such as "Q3 2026 retrospective"
//   - {boolean} [muted=false] - Whether the soundtrack is silenced
//   - {Function|null} [renderInteractiveSlide] - (slide, { onDone, onReplay }) => the controls an interactive slide
//     shows in place of its body, or null for a slide that plays as usual; onDone moves the story to the next slide and
//     onReplay starts it over from the first
//   - {Array<object>} slides - From slidesFromStatistics
//   - {number} [slideMilliseconds=SLIDE_MILLISECONDS] - How long a data-rich slide shows before advancing, times the
//     slide's slideDurationFactor, which shortens a slide with few words and lengthens the heap
//   - {string|null} [soundtrackVibe] - A RETROSPECTIVE_SOUNDTRACK_VIBES value for the soundtrack
// @returns {JSX.Element} The story.
export default function RetrospectiveStory({ audioContext = null, backgroundPhotoSeed = null, label, muted = false,
    renderInteractiveSlide = null, slides, slideMilliseconds = SLIDE_MILLISECONDS, soundtrackVibe = null }) {
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [held, setHeld] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const pressStartedAt = useRef(0);
  const suppressNextTap = useRef(false);
  const lastIndex = slides.length - 1;
  // A slide that needs longer, such as the heap, stretches its own clock; one with few words shortens it.
  const currentMilliseconds = slideMilliseconds * slideDurationFactor(slides[index]);
  // @desc Show a slide from the start of its clock.
  const showSlide = nextIndex => {
    setIndex(nextIndex);
    setElapsed(0);
  };
  // @desc Step to a slide. Stepping back from the first slide restarts it; stepping past the last does nothing.
  const goTo = nextIndex => {
    if (nextIndex > lastIndex) return;
    showSlide(Math.max(0, nextIndex));
  };
  const interactiveBody = renderInteractiveSlide ? renderInteractiveSlide(slides[index], { onDone: () => goTo(index + 1),
    onReplay: () => goTo(0) }) : null;
  const interactive = !!interactiveBody;
  const finished = index === lastIndex && (interactive || elapsed >= currentMilliseconds);
  const paused = held || userPaused || finished || interactive;
  const showPausedBadge = (held || userPaused) && !finished && !interactive;
  const showPauseHint = index === 0 && !paused;
  const photoUrl = backgroundPhotoSeed ? retrospectiveBackgroundUrl(backgroundPhotoSeed, index) : null;

  useStoryClock({ elapsed, index, paused, setElapsed, showSlide, slideCount: slides.length, slideMilliseconds: currentMilliseconds });
  useStorySoundtrack({ audioContext, finished, muted, slideMilliseconds, soundtrackVibe, userPaused });
  usePreloadedBackgroundPhoto({ backgroundPhotoSeed, index, slideCount: slides.length });

  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === "ArrowRight") goTo(index + 1);
      else if (event.key === "ArrowLeft") goTo(index - 1);
      else if (event.key === " " && !interactive) {
        event.preventDefault();
        setUserPaused(previous => !previous);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [index, interactive, lastIndex]);

  // @desc Begin a press that may become a hold. An interactive slide's controls take presses, and a drag among them
  //   never ends in a pointerup, so presses there are left alone.
  const pressStart = () => {
    if (interactive) return;
    pressStartedAt.current = Date.now();
    suppressNextTap.current = false;
    setHeld(true);
  };
  // @desc End a press. A press long enough to have paused the story swallows the click that follows it, so letting
  //   go after a hold does not also change slides.
  const pressEnd = () => {
    if (pressStartedAt.current) suppressNextTap.current = Date.now() - pressStartedAt.current > HOLD_MILLISECONDS;
    pressStartedAt.current = 0;
    setHeld(false);
  };
  // @desc A tap zone's click. A keyboard activation has no press before it, so it always counts.
  const tapTo = offset => () => {
    if (suppressNextTap.current) {
      suppressNextTap.current = false;
      return;
    }
    goTo(index + offset);
  };
  const segmentFill = segmentIndex => {
    if (segmentIndex < index) return 1;
    if (segmentIndex > index) return 0;
    return Math.min(1, elapsed / currentMilliseconds);
  };

  let footerControl = null;
  if (!finished) {
    footerControl = (
      <button aria-label={ userPaused ? "Play story" : "Pause story" } className="retrospective-story-control"
        onClick={ () => setUserPaused(previous => !previous) } type="button">
        { userPaused ? "▶ Play" : "❚❚ Pause" }
      </button>
    );
  } else if (!interactive) {
    footerControl = <button className="retrospective-story-control" onClick={ () => goTo(0) } type="button">↺ Replay</button>;
  }

  return (
    <div aria-label={ label } aria-roledescription="story" className="retrospective-story" onPointerCancel={ pressEnd }
      onPointerDown={ pressStart } onPointerLeave={ pressEnd } onPointerUp={ pressEnd } role="region">
      <div className="retrospective-story-progress">
        { slides.map((slide, segmentIndex) => <ProgressSegment fill={ segmentFill(segmentIndex) } key={ slide.id } />) }
      </div>
      <RetrospectiveSlide key={ slides[index].id } photoUrl={ photoUrl } position={ index } slide={ slides[index] }>
        { interactiveBody }
      </RetrospectiveSlide>
      { interactive ? null : (
        <>
          <button aria-label="Previous slide" className="retrospective-story-tap retrospective-story-tap--previous"
            onClick={ tapTo(-1) } type="button" />
          <button aria-label="Next slide" className="retrospective-story-tap retrospective-story-tap--next" onClick={ tapTo(1) }
            type="button" />
        </>
      ) }
      <div className="retrospective-story-footer">
        <span className="retrospective-story-counter">{ `${ index + 1 } / ${ slides.length }` }</span>
        { showPauseHint ? <span className="retrospective-story-hint">Hold anywhere or press Space to pause</span> : null }
        { showPausedBadge ? <span aria-hidden="true" className="retrospective-story-paused-badge">❚❚ Paused</span> : null }
        { footerControl }
      </div>
    </div>
  );
}
