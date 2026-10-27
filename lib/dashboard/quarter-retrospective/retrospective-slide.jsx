// One slide of the Quarter Retrospective story: a kicker, a large figure that counts up from zero, a headline, an
// optional ranked list, a caption, and an optional explanation with a detail that opens on hover or tap. A slide's
// kind adds what it draws between its headline and caption: done and open bars per project, each project's hardest tasks, the progress heap, or a timeline of months; a photo slide sets one of the user's images behind
// its words. The hardest tasks list is exported so the story can show it with a link per project to document it. Behind the words of every other slide sit two drifting shapes placed by the slide's position, film grain,
// and, when the story gives one, an abstract photo blended into the slide's tone. Each part enters a beat after the one
// above it, and the slide is remounted for every slide shown, so the entrance replays as the story advances.
import RetrospectiveHeap from "dashboard/quarter-retrospective/retrospective-heap";
import { SLIDE_KINDS } from "dashboard/quarter-retrospective/retrospective-slides";
import { useEffect, useId, useState } from "react";
import { prefersReducedMotion } from "util/browser-utility";
import { logIfEnabled } from "util/log";

const COUNT_UP_MILLISECONDS = 1200;
// The shapes behind a slide take one of this many arrangements, in turn as the story advances.
export const BACKDROP_LAYOUT_COUNT = 4;

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
// @desc Each project's hardest tasks, as rated for difficulty, in a list that scrolls when the projects outgrow the slide.
//   Given onDocumentProject, each project ends in a "Document how you did it" link that says so while its note opens
//   and reports a failure beside it.
// @param {object} props - An object with the following properties:
//   - {Array<object>} hardestProjects - { name, taskCount, tasks } per project, tasks as { difficulty, text }
//   - {Function|null} [onDocumentProject] - async (project) => void; opens the project's documentation note
// @returns {JSX.Element} The projects.
export function SlideHardestTasks({ hardestProjects, onDocumentProject = null }) {
  const [documentState, setDocumentState] = useState({ failedIndex: null, openingIndex: null });
  // @desc Open a project's documentation note, reporting a failure rather than leaving the link waiting.
  const documentProject = async (project, index) => {
    setDocumentState({ failedIndex: null, openingIndex: index });
    try {
      await onDocumentProject(project);
      setDocumentState({ failedIndex: null, openingIndex: null });
    } catch (error) {
      logIfEnabled("[retrospective-slide] could not open the documentation note", error?.message);
      setDocumentState({ failedIndex: index, openingIndex: null });
    }
  };

  return (
    <ol className="retrospective-slide-hardest-projects">
      { hardestProjects.map((project, index) => (
        <li className="retrospective-slide-hardest-project" key={ `${ index }-${ project.name }` } style={{ "--item-index": index }}>
          <h3 className="retrospective-slide-hardest-project-name">{ project.name }</h3>
          <ol className="retrospective-slide-hardest-tasks">
            { project.tasks.map((task, taskIndex) => (
              <li className="retrospective-slide-hardest-task" key={ `${ taskIndex }-${ task.text }` }>
                <span className="retrospective-slide-hardest-task-text">{ task.text }</span>
                <span className="retrospective-slide-hardest-task-difficulty">{ `${ task.difficulty }/10` }</span>
              </li>
            )) }
          </ol>
          { onDocumentProject ? (
            <button className="retrospective-slide-document-link" disabled={ documentState.openingIndex !== null }
              onClick={ () => documentProject(project, index) } type="button">
              { documentState.openingIndex === index ? "Opening…" : "Document how you did it" }
            </button>
          ) : null }
          { documentState.failedIndex === index ? (
            <p className="retrospective-slide-document-error" role="alert">Couldn't open the note. Try again.</p>
          ) : null }
        </li>
      )) }
    </ol>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc A slide's explanation, and a prompt such as "How do we calculate it?" whose detail opens above it while a mouse
//   hovers over it, and opens or closes on a click or tap, so a touch screen can read it too. The detail stays open
//   once clicked until clicked again, and the slide reports whether it is open so the story can wait while it's read.
// @param {object} props - An object with the following properties:
//   - {string|null} explanation - The paragraph shown on the slide
//   - {object|null} explanationDetail - { label, paragraphs }: the prompt and the detail it opens
//   - {Function|null} onDetailOpenChange - (open) => void
// @returns {JSX.Element} The explanation.
function SlideExplanation({ explanation, explanationDetail, onDetailOpenChange }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;
  const detailId = useId();

  useEffect(() => {
    onDetailOpenChange?.(open);
  }, [open]);

  return (
    <div className="retrospective-slide-explanation">
      { explanation ? <p className="retrospective-slide-explanation-text">{ explanation }</p> : null }
      { explanationDetail ? (
        <div className="retrospective-slide-explanation-detail-anchor"
          onPointerEnter={ event => { if (event.pointerType === "mouse") setHovered(true); } }
          onPointerLeave={ event => { if (event.pointerType === "mouse") setHovered(false); } }>
          <button aria-controls={ detailId } aria-expanded={ open } className="retrospective-slide-explanation-prompt"
            onClick={ () => setPinned(previous => !previous) } type="button">
            <span aria-hidden="true" className="retrospective-slide-explanation-icon">i</span>
            { explanationDetail.label }
          </button>
          { open ? (
            <div className="retrospective-slide-explanation-detail" id={ detailId } role="tooltip">
              { explanationDetail.paragraphs.map((paragraph, index) => <p key={ index }>{ paragraph }</p>) }
            </div>
          ) : null }
        </div>
      ) : null }
    </div>
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
// @desc The decorative layers behind a slide's words: an abstract photo blended into the slide's tone when one is given,
//   two large shapes arranged by the slide's position, and film grain. A photo fades in once loaded, and one that fails
//   to load is removed, leaving the shapes on the tone.
// @param {object} props - { photoUrl, position }: photoUrl may be null; position is the slide's place in the story.
// @returns {JSX.Element} The backdrop, hidden from screen readers.
function SlideBackdrop({ photoUrl, position }) {
  const [photoState, setPhotoState] = useState("loading");
  const layout = Math.abs(Math.trunc(position)) % BACKDROP_LAYOUT_COUNT;
  return (
    <div aria-hidden="true" className={ `retrospective-slide-backdrop retrospective-slide-backdrop--layout-${ layout }` }>
      { photoUrl && photoState !== "failed" ? (
        <img alt="" className={ `retrospective-backdrop-photo retrospective-backdrop-photo--${ photoState }` }
          onError={ () => setPhotoState("failed") } onLoad={ () => setPhotoState("loaded") } src={ photoUrl } />
      ) : null }
      <span className="retrospective-backdrop-shape retrospective-backdrop-shape--glow" />
      <span className="retrospective-backdrop-shape retrospective-backdrop-shape--blob" />
      <span className="retrospective-backdrop-grain" />
    </div>
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
  if (slide.kind === SLIDE_KINDS.hardestTasks && slide.hardestProjects?.length) {
    return <SlideHardestTasks hardestProjects={ slide.hardestProjects } />;
  }
  if (slide.kind === SLIDE_KINDS.heap && slide.heap?.blocks?.length) return <RetrospectiveHeap heap={ slide.heap } />;
  if (slide.kind === SLIDE_KINDS.timeline && slide.columns?.length) return <SlideTimeline columns={ slide.columns } />;
  if (slide.items?.length) return <SlideItems items={ slide.items } />;
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc Render one slide.
// @param {object} props - An object with the following properties:
//   - {JSX.Element|null} [children] - Controls shown in place of the slide's body, for an interactive slide
//   - {Function|null} [onDetailOpenChange] - (open) => void, told when the explanation's detail opens or closes
//   - {string|null} [photoUrl] - An abstract photo to blend behind the words; none leaves the shapes on the tone alone
//   - {number} [position=0] - The slide's zero-based place in the story, which arranges the shapes behind it
//   - {object} slide - From slidesFromStatistics or the story writer: { caption, explanation?, explanationDetail?, figure,
//     headline, id, items, kicker, kind, subheadline?, tone }, plus what its kind draws
// @returns {JSX.Element} The slide.
export default function RetrospectiveSlide({ children = null, onDetailOpenChange = null, photoUrl = null, position = 0, slide }) {
  if (slide.kind === SLIDE_KINDS.image && slide.imageUrl) return <ImageSlide slide={ slide } />;
  return (
    <section aria-roledescription="slide" className={ `retrospective-slide retrospective-slide--${ slide.kind || SLIDE_KINDS.figure } `
      + `retrospective-slide--${ slide.tone }` }>
      <p className="retrospective-slide-kicker">{ slide.kicker }</p>
      { slide.figure ? <SlideFigure figure={ slide.figure } /> : null }
      <h2 className="retrospective-slide-headline">{ slide.headline }</h2>
      { slide.subheadline ? <p className="retrospective-slide-subheadline">{ slide.subheadline }</p> : null }
      { children || <SlideBody slide={ slide } /> }
      { slide.caption ? <p className="retrospective-slide-caption">{ slide.caption }</p> : null }
      { slide.explanation || slide.explanationDetail ? (
        <SlideExplanation explanation={ slide.explanation || null } explanationDetail={ slide.explanationDetail || null }
          onDetailOpenChange={ onDetailOpenChange } />
      ) : null }
      <SlideBackdrop photoUrl={ photoUrl } position={ position } />
    </section>
  );
}
