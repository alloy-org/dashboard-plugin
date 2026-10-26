// One slide of the Quarter Retrospective story: a kicker, a large figure that counts up from zero, a headline, an
// optional ranked list, and a caption. Each part enters a beat after the one above it, and the slide is remounted
// for every slide shown, so the entrance replays as the story advances.
import { useEffect, useState } from "react";

const COUNT_UP_MILLISECONDS = 1200;

// ----------------------------------------------------------------------------------------------
// @desc Whether the viewer asked for reduced motion. jsdom and older embeds lack matchMedia, which reads as no.
// @returns {boolean} True when motion should be skipped.
function prefersReducedMotion() {
  try {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Count from zero up to a value with an ease-out curve. Without requestAnimationFrame, or with reduced
//   motion, the value is shown at once.
// @param {number} value - The value to land on.
// @returns {number} The whole number to display this frame.
function useCountUp(value) {
  const animated = typeof requestAnimationFrame === "function" && !prefersReducedMotion();
  const [displayed, setDisplayed] = useState(animated ? 0 : value);

  useEffect(() => {
    if (!animated) {
      setDisplayed(value);
      return undefined;
    }
    let frameId = null;
    const startedAt = performance.now();
    const step = now => {
      const progress = Math.min(1, (now - startedAt) / COUNT_UP_MILLISECONDS);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(value * eased));
      if (progress < 1) frameId = requestAnimationFrame(step);
    };
    frameId = requestAnimationFrame(step);
    return () => { if (frameId !== null) cancelAnimationFrame(frameId); };
  }, [animated, value]);

  return displayed;
}

// ----------------------------------------------------------------------------------------------
// @desc The slide's large number. Screen readers are given the final value rather than each frame of the count.
// @param {object} props - { figure } as { prefix, suffix, value }.
// @returns {JSX.Element} The figure.
function SlideFigure({ figure }) {
  const displayed = useCountUp(figure.value);
  const finalText = `${ figure.prefix }${ figure.value.toLocaleString() }${ figure.suffix }`;
  return (
    <p aria-label={ finalText } className="retrospective-slide-figure" role="img">
      <span aria-hidden="true">{ figure.prefix }{ displayed.toLocaleString() }{ figure.suffix }</span>
    </p>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render one slide.
// @param {object} props - An object with the following properties:
//   - {object} slide - From slidesFromStatistics: { caption, figure, headline, id, items, kicker, tone }
// @returns {JSX.Element} The slide.
export default function RetrospectiveSlide({ slide }) {
  return (
    <section aria-roledescription="slide" className={ `retrospective-slide retrospective-slide--${ slide.tone }` }>
      <p className="retrospective-slide-kicker">{ slide.kicker }</p>
      { slide.figure ? <SlideFigure figure={ slide.figure } /> : null }
      <h2 className="retrospective-slide-headline">{ slide.headline }</h2>
      { slide.items.length ? (
        <ol className="retrospective-slide-items">
          { slide.items.map((item, index) => (
            <li className="retrospective-slide-item" key={ `${ index }-${ item.label }` } style={{ "--item-index": index }}>
              <span className="retrospective-slide-item-label">{ item.label }</span>
              { item.value ? <span className="retrospective-slide-item-value">{ item.value }</span> : null }
            </li>
          )) }
        </ol>
      ) : null }
      <p className="retrospective-slide-caption">{ slide.caption }</p>
    </section>
  );
}
