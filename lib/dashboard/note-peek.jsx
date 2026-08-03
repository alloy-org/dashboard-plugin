import { useWidgetLoadedEvent } from "dashboard-load-tracking";
import { fetchNotePeekHtml, NOTE_PEEK_WIDGET_ID, notePeekSelectionFromSettings, promptForNotePeekNote,
  storeNotePeekSelection } from "note-peek-service";
import { pluginSettings } from "plugin-data";
import { useCallback, useEffect, useRef, useState } from "react";
import "styles/note-peek.scss";
import { attachFootnotePopups } from "util/amplenote-markdown-render";
import { logIfEnabled } from "util/log";
import WidgetWrapper from "widget-wrapper";

// Matches the "⚙ Configure" link DraggableHeading renders for every configurable widget, so the body
// button before a note is chosen names the same action as the header link beside it.
const CONFIGURE_LABEL = "⚙ Configure";

// ----------------------------------------------------------------------------------------------
// @desc Hook: load the rendered HTML for the selected note, re-fetching whenever the selection changes
//   and ignoring a resolution that lands after the selection moved on. `html` is null while loading and
//   "" for a note with no content, so the body can tell those two states apart.
// @param {Object} params - { app, noteUUID }. `noteUUID` is null until the user picks a note.
// @returns {{error: string|null, html: string|null}}
function useRenderedNoteHtml({ app, noteUUID }) {
  const [error, setError] = useState(null);
  const [html, setHtml] = useState(null);
  useEffect(() => {
    setError(null);
    setHtml(null);
    if (!noteUUID) return undefined;
    let isActive = true;
    fetchNotePeekHtml(app, noteUUID).then(result => {
      if (!isActive) return;
      setHtml(result);
      logIfEnabled(`[NotePeek] rendered note ${ noteUUID } (${ result.length } chars of HTML)`);
    }).catch(err => {
      if (!isActive) return;
      logIfEnabled("[NotePeek] failed to render note:", err);
      setError(err.message || "Failed to load this note");
    });
    return () => { isActive = false; };
  }, [app, noteUUID]);
  return { error, html };
}

// ----------------------------------------------------------------------------------------------
// @desc The whole-body target shown before a note has been chosen: clicking or tapping anywhere in the
//   widget opens the note selector, and a Configure button inside it does the same thing for anyone
//   looking for something to press. The button carries no handler of its own — its click bubbles to the
//   wrapper, so either target opens exactly one prompt.
// @param {Object} props - { onChoose }. `onChoose` opens the note-selector prompt.
// @returns {JSX.Element} A full-size clickable region filling the widget body.
function NotePeekChooser({ onChoose }) {
  return (
    <div className="note-peek-chooser" onClick={onChoose} role="presentation" title="Choose a note">
      <span className="note-peek-chooser-icon">📄</span>
      <span className="note-peek-chooser-label">Choose a note to display here</span>
      <button className="note-peek-chooser-button" type="button">{CONFIGURE_LABEL}</button>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc The widget body: the note chooser when nothing is selected, otherwise the loading/empty/error
//   state or the note's rendered HTML. Content that exceeds the cell is clipped rather than scrolled
//   (see note-peek.scss), so the widget always occupies exactly the size the user chose for it.
// @param {Object} props - { error, html, onChoose, selection }. `html` is null while loading, "" when
//   the chosen note has no content; `selection` is null until a note has been chosen.
// @returns {JSX.Element} Body content for the WidgetWrapper.
function NotePeekBody({ error, html, onChoose, selection }) {
  const contentRef = useRef(null);
  // Rich footnotes reach the widget as markup only the popup wiring can finish: when the HTML carries
  // rich-footnote links, give them their tippy popups so a footnote's picture and description are
  // reachable; HTML without them is left untouched.
  useEffect(() => { if (html) attachFootnotePopups(contentRef.current); }, [html]);

  if (!selection) return (<NotePeekChooser onChoose={onChoose} />);
  if (error) return (<p className="note-error">{`Error: ${ error }`}</p>);
  if (html === null) return (<p className="note-loading">Loading…</p>);
  if (html === "") return (<p className="note-empty">This note has no content yet.</p>);
  return (<div className="note-peek-content" ref={contentRef} dangerouslySetInnerHTML={{ __html: html }} />);
}

// ----------------------------------------------------------------------------------------------
// @desc Note Peek widget — displays one note of the user's choosing, rendered through
//   app.htmlFromContent so tables, checkboxes, images, and rich footnotes appear as they do in the
//   editor. The chosen note is remembered in the widget's setting, so it survives dashboard reloads.
// @param {Object} props - Component props.
// @param {Object} props.app - Amplenote app bridge passed down from the dashboard cell.
// @returns {JSX.Element} The rendered widget.
// [Claude claude-opus-5 (1M context)] Task: render a user-chosen note's content inside a dashboard cell
// Prompt: "utilize app.htmlFromContent to ensure the full breadth of markdown content is displayed"
export default function NotePeekWidget({ app }) {
  const [selection, setSelection] = useState(() => notePeekSelectionFromSettings(pluginSettings()));
  const { error, html } = useRenderedNoteHtml({ app, noteUUID: selection?.noteUUID || null });

  const chooseNote = useCallback(async () => {
    const chosen = await promptForNotePeekNote(app, selection?.noteName || null);
    if (!chosen) return;
    await storeNotePeekSelection(app, chosen);
    setSelection(chosen);
  }, [app, selection]);

  // An unconfigured widget has finished loading as soon as it renders its chooser; a configured one settles once its note resolves (or fails).
  useWidgetLoadedEvent(NOTE_PEEK_WIDGET_ID, !selection || html !== null, !!error);

  // Once a note is chosen, the note is changed from the header's standard "⚙ Configure" link, the same
  // control every other configurable widget offers. Before then the body's own button is the way in.
  return (
    <WidgetWrapper configurable={!!selection} onConfigure={chooseNote} subtitle={selection?.noteName || null}
        widgetId={NOTE_PEEK_WIDGET_ID}>
      <NotePeekBody error={error} html={html} onChoose={chooseNote} selection={selection} />
    </WidgetWrapper>
  );
}
