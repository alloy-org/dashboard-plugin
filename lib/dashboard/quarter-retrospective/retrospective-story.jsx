// Play the Quarter Retrospective's slides as a story: a segmented progress bar across the top, each slide advancing
// on its own after a few seconds, a tap on the left or right side stepping back or ahead, pressing and holding to
// pause, and the arrow keys and Space doing the same from the keyboard. The story stops on its last slide.
import RetrospectiveSlide from "dashboard/quarter-retrospective/retrospective-slide";
import { useEffect, useRef, useState } from "react";

export const SLIDE_MILLISECONDS = 6000;
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
// @desc The story player.
// @param {object} props - An object with the following properties:
//   - {string} label - Accessible name for the story, such as "Q3 2026 retrospective"
//   - {Array<object>} slides - From slidesFromStatistics
//   - {number} [slideMilliseconds=SLIDE_MILLISECONDS] - How long each slide shows before advancing
// @returns {JSX.Element} The story.
export default function RetrospectiveStory({ label, slides, slideMilliseconds = SLIDE_MILLISECONDS }) {
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [held, setHeld] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const pressStartedAt = useRef(0);
  const suppressNextTap = useRef(false);
  const lastIndex = slides.length - 1;
  const finished = index === lastIndex && elapsed >= slideMilliseconds;
  const paused = held || userPaused || finished;

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

  useStoryClock({ elapsed, index, paused, setElapsed, showSlide, slideCount: slides.length, slideMilliseconds });

  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === "ArrowRight") goTo(index + 1);
      else if (event.key === "ArrowLeft") goTo(index - 1);
      else if (event.key === " ") {
        event.preventDefault();
        setUserPaused(previous => !previous);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [index, lastIndex]);

  const pressStart = () => {
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
    return Math.min(1, elapsed / slideMilliseconds);
  };

  return (
    <div aria-label={ label } aria-roledescription="story" className="retrospective-story" onPointerCancel={ pressEnd }
      onPointerDown={ pressStart } onPointerLeave={ pressEnd } onPointerUp={ pressEnd } role="region">
      <div className="retrospective-story-progress">
        { slides.map((slide, segmentIndex) => <ProgressSegment fill={ segmentFill(segmentIndex) } key={ slide.id } />) }
      </div>
      <RetrospectiveSlide key={ slides[index].id } slide={ slides[index] } />
      <button aria-label="Previous slide" className="retrospective-story-tap retrospective-story-tap--previous"
        onClick={ tapTo(-1) } type="button" />
      <button aria-label="Next slide" className="retrospective-story-tap retrospective-story-tap--next" onClick={ tapTo(1) }
        type="button" />
      <div className="retrospective-story-footer">
        <span className="retrospective-story-counter">{ `${ index + 1 } / ${ slides.length }` }</span>
        { finished ? (
          <button className="retrospective-story-control" onClick={ () => goTo(0) } type="button">↺ Replay</button>
        ) : (
          <button className="retrospective-story-control" onClick={ () => setUserPaused(previous => !previous) } type="button">
            { userPaused ? "▶ Play" : "❚❚ Pause" }
          </button>
        ) }
      </div>
    </div>
  );
}
