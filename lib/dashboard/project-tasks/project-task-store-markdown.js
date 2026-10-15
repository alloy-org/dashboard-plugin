// Name the headings that structure the quarterly project task store: the two roots its projects sit beneath and the
// heading each project's section carries. A project's section body is QuarterProject's to render and read back.
import { linkLabelFromMarkdown } from "util/amplenote-rich-footnote-writing";

export const ACTIVE_PROJECTS_HEADING = "Active projects";
export const PAST_PROJECTS_HEADING = "Past projects";
export const STORE_PREAMBLE_TEXT = "Maintained by the Dashboard. Task associations and ideas are collected in the "
  + "background after each dashboard load, so calendar suggestions can be produced without waiting for discovery.";

// ----------------------------------------------------------------------------------------------
// @desc Compose the two root headings a new store note begins with, so every later write targets a section
//   that already exists rather than appending to the end of the note.
// @returns {string} Initial note markdown carrying both project roots and no projects.
export function initialProjectTaskStoreMarkdown() {
  return `${ STORE_PREAMBLE_TEXT }\n\n# ${ ACTIVE_PROJECTS_HEADING }\n\n# ${ PAST_PROJECTS_HEADING }\n`;
}

// ----------------------------------------------------------------------------------------------
// @desc Build the heading text identifying one project's section. The UUID is carried in the heading so a
//   renamed project keeps its section, and so two projects sharing a summary remain distinguishable.
//   A summary carrying its own markdown link would split the heading in two, so it is flattened the same way
//   task text is. Footnote references are dropped rather than renumbered, because a heading cannot carry the
//   definitions they would need; the same flattening runs when the heading is looked up, so existing sections
//   still match.
// @param {object} project - Project record with `summary` and `uuid`.
// @returns {string} Heading text, without its leading hashes.
export function projectSectionHeadingText(project) {
  return `${ linkLabelFromMarkdown(project.summary, null, "Untitled project") } (project:${ project.uuid })`;
}
