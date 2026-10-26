// One slide of the Quarter Retrospective story: a kicker, a large figure that counts up from zero, a headline, an
// optional ranked list, and a caption. A slide's kind adds what it draws between its headline and caption: done and
// open bars per project, the progress heap, or a timeline of months; a photo slide sets one of the user's images behind
// its words. Each part enters a beat after the one above it, and the slide is remounted for every slide shown, so the
// entrance replays as the story advances.
import RetrospectiveHeap from "dashboard/quarter-retrospective/retrospective-heap";
import { SLIDE_KINDS } from "dashboard/quarter-retrospective/retrospective-slides";
import { useEffect, useState } from "react";
import { prefersReducedMotion } from "util/browser-utility";

const COUNT_UP_MILLISECONDS = 1200;

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
// @desc Each project's done tasks beside those still open, as one bar per project split into done and open, all bars
//   on one scale so a project's size shows too.
// @param {object} props - { bars } as { done, label, open } per project.
// @returns {JSX.Element} The bars.
function SlideBars({ bars }) {
  const largestTotal = Math.max(1, ...bars.map(bar => bar.done + (bar.open || 0)));
  return (
    <ol className="retrospective-slide-bars">
      { bars.map((bar, index) => (
        <li className="retrospective-slide-bar" key={ `${ index }-${ bar.label }` } style={{ "--item-index": index }}>
          <span className="retrospective-slide-bar-label">{ bar.label }</span>
          <span className="retrospective-slide-bar-value">{ `${ bar.done } done · ${ bar.open || 0 } open` }</span>
          <span aria-hidden="true" className="retrospective-slide-bar-track">
            <span className="retrospective-slide-bar-done" style={{ width: `${ (bar.done / largestTotal) * 100 }%` }} />
            <span className="retrospective-slide-bar-open" style={{ width: `${ ((bar.open || 0) / largestTotal) * 100 }%` }} />
          </span>
        </li>
      )) }
    </ol>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter's months as columns rising to their task counts, each with its highlight beneath when it has one.
// @param {object} props - { columns } as { label, note, value } per month.
// @returns {JSX.Element} The timeline.
function SlideTimeline({ columns }) {
  const largestValue = Math.max(1, ...columns.map(column => column.value));
  return (
    <ol className="retrospective-slide-timeline">
      { columns.map((column, index) => (
        <li className="retrospective-slide-timeline-month" key={ `${ index }-${ column.label }` } style={{ "--item-index": index }}>
          <span className="retrospective-slide-timeline-value">{ column.value.toLocaleString() }</span>
          <span aria-hidden="true" className="retrospective-slide-timeline-track">
            <span className="retrospective-slide-timeline-column" style={{ height: `${ (column.value / largestValue) * 100 }%` }} />
          </span>
          <span className="retrospective-slide-timeline-label">{ column.label }</span>
          { column.note ? <span className="retrospective-slide-timeline-note">{ column.note }</span> : null }
        </li>
      )) }
    </ol>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc A ranked list of rows, each a label and an optional value.
// @param {object} props - { items } as { label, value } rows.
// @returns {JSX.Element} The list.
function SlideItems({ items }) {
  return (
    <ol className="retrospective-slide-items">
      { items.map((item, index) => (
        <li className="retrospective-slide-item" key={ `${ index }-${ item.label }` } style={{ "--item-index": index }}>
          <span className="retrospective-slide-item-label">{ item.label }</span>
          { item.value ? <span className="retrospective-slide-item-value">{ item.value }</span> : null }
        </li>
      )) }
    </ol>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc A photo slide: the image fills the slide behind a darkening scrim, with the words along the bottom. An image
//   that fails to load is removed, leaving the slide's tone behind the words.
// @param {object} props - { slide }.
// @returns {JSX.Element} The slide.
function ImageSlide({ slide }) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <section aria-roledescription="slide" className={ `retrospective-slide retrospective-slide--image retrospective-slide--${ slide.tone }` }>
      { imageFailed ? null : (
        <img alt="" className="retrospective-slide-photo" onError={ () => setImageFailed(true) } src={ slide.imageUrl } />
      ) }
      <span aria-hidden="true" className="retrospective-slide-scrim" />
      <p className="retrospective-slide-kicker">{ slide.kicker }</p>
      <h2 className="retrospective-slide-headline">{ slide.headline }</h2>
      <p className="retrospective-slide-caption">{ slide.caption }</p>
    </section>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc What a slide draws between its headline and caption, by its kind. A slide saved before kinds existed is a
//   figure slide.
// @param {object} props - { slide }.
// @returns {JSX.Element|null} The drawing, or null when the slide has none.
function SlideBody({ slide }) {
  if (slide.kind === SLIDE_KINDS.bars && slide.bars?.length) return <SlideBars bars={ slide.bars } />;
  if (slide.kind === SLIDE_KINDS.heap && slide.heap?.blocks?.length) return <RetrospectiveHeap heap={ slide.heap } />;
  if (slide.kind === SLIDE_KINDS.timeline && slide.columns?.length) return <SlideTimeline columns={ slide.columns } />;
  if (slide.items?.length) return <SlideItems items={ slide.items } />;
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc Render one slide.
// @param {object} props - An object with the following properties:
//   - {object} slide - From slidesFromStatistics or the story writer: { caption, figure, headline, id, items, kicker,
//     kind, tone }, plus what its kind draws
// @returns {JSX.Element} The slide.
export default function RetrospectiveSlide({ slide }) {
  if (slide.kind === SLIDE_KINDS.image && slide.imageUrl) return <ImageSlide slide={ slide } />;
  return (
    <section aria-roledescription="slide" className={ `retrospective-slide retrospective-slide--${ slide.kind || SLIDE_KINDS.figure } `
      + `retrospective-slide--${ slide.tone }` }>
      <p className="retrospective-slide-kicker">{ slide.kicker }</p>
      { slide.figure ? <SlideFigure figure={ slide.figure } /> : null }
      <h2 className="retrospective-slide-headline">{ slide.headline }</h2>
      <SlideBody slide={ slide } />
      { slide.caption ? <p className="retrospective-slide-caption">{ slide.caption }</p> : null }
    </section>
  );
}
