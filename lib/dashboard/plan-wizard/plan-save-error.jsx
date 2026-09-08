// Save-failure alert for a wizard page: the thrown message, plus a link to the Vision Guide data note when that
// note is known so an oversized section can be inspected rather than only described.

import { noteUrlFromUUID } from "app-util";
import { navigateToNote } from "util/goal-notes";

const DATA_NOTE_LINK_LABEL = "Open data note";

// ----------------------------------------------------------------------------------------------
// @desc Render a save failure and, when a Vision Guide UUID is known, a link that opens that note. In the
//   production plugin the link navigates to Amplenote; in the dev environment it asks the wizard to show the
//   note in the inline editor.
// @param {object} params - An object with the following properties:
//   - {object} app - Amplenote embed app proxy.
//   - {string|null} noteUuid - Fallback Vision Guide UUID from the loaded planning context.
//   - {Function} onOpenDataNote - Receives a note UUID when the dev environment should show the editor.
//   - {string} prefix - Sentence naming what failed to save, such as "Your project paces were not saved."
//   - {Error} saveError - Failure retained for retry; overflow errors carry `noteUuid`.
// @returns {JSX.Element} Alert with optional data-note link.
export default function PlanSaveError({ app, noteUuid, onOpenDataNote, prefix, saveError }) {
  const dataNoteUuid = saveError?.noteUuid ?? noteUuid ?? null;
  const noteUrl = dataNoteUuid ? noteUrlFromUUID(dataNoteUuid) : null;

  // ----------------------------------------------------------------------------------------------
  // @desc Open the Vision Guide: Amplenote in production, the inline editor when navigateToNote signals dev.
  // @param {object} event - Click on the data-note link.
  const handleOpenDataNote = async event => {
    event.preventDefault();
    if (!dataNoteUuid) return;
    const result = await navigateToNote(app, dataNoteUuid);
    if (result?.devEdit) onOpenDataNote(dataNoteUuid);
  };

  return (
    <p className="plan-error" role="alert">
      { prefix } { saveError.message }
      { noteUrl ? (
        <>
          { " " }
          <a className="plan-error-note-link" href={ noteUrl } onClick={ handleOpenDataNote }>{ DATA_NOTE_LINK_LABEL }</a>
        </>
      ) : null }
    </p>
  );
}
