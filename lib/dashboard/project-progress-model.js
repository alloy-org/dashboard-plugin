// Derive the quarter's projects from Plan Builder's Vision Guide and the quarterly plan note, carrying forward
// each project's stored identity and task evidence. QuarterProject owns the matching and completion logic.
import { isCompletedActionProspect, planningRecordUuid } from "plan-wizard/plan-models";
import { bulletValueFromBody, isCompleteMarkedText, isEmptyProjectPlaceholder, planSectionRange, projectBlocksFromBody,
  textWithoutBuilderMarker } from "plan-wizard/quarterly-plan-markdown";
import QuarterProject from "quarter-project";
import { parsedRichFootnotes, passageWithResolvedFootnotes } from "util/amplenote-rich-footnotes";

// ----------------------------------------------------------------------------------------------
// @desc Reuse Plan Builder UUIDs and retain generated identities for projects authored directly in Quarterly Goals.
//   A project marked Complete, in the Vision Guide or by its plan-note heading, is left out so agendas stop
//   proposing work for it.
// @param {object} options - { guide, previousProjects, quarterlyContent, scope }.
// @returns {Array<QuarterProject>} Active projects, retaining old records separately at the storage layer.
export function quarterlyProgressProjects({ guide, previousProjects, quarterlyContent, scope }) {
  const envelopes = [guide?.workProspects, guide?.personalProspects].filter(Boolean);
  const prospects = envelopes.flatMap(envelope => envelope.prospects || []);
  const liveProspects = prospects.filter(project => project.quarterKey === scope.quarterKey
    && !["humanRejected", "humanRetired"].includes(project.approvalStatusEm)
    && ["quarterFocus", "monthFocus", "stayWarm"].includes(project.priorityEm) && !isCompletedActionProspect(project));
  const projects = liveProspects.map(project => {
    const previous = previousProjects.find(record => record.uuid === project.uuid || record.summary === project.summary);
    const linkedTasks = envelopes.flatMap(envelope => envelope.prospectTasks || []);
    const acceptedTasks = linkedTasks.filter(task => task.prospectUuid === project.uuid && task.approvalStatus !== "humanRejected");
    const taskUuids = acceptedTasks.map(task => task.taskUuid).filter(Boolean);
    const blocksPerWeek = { oneSubstantialBlock: 1, smallMoveMostDays: 5, twoFocusedBlocks: 2 }[project.paceEm] || null;
    return new QuarterProject({ ...previous, blocksPerWeek, completedTasks: previous?.completedTasks || [],
      deadlineOn: project.deadlineOn || null, focusMonths: project.focusMonths,
      nextAction: acceptedTasks.find(task => !task.taskUuid && !task.completedAt)?.taskText || null,
      paceEm: project.paceEm, preferredWeekdays: project.preferredWeekdays, primaryNoteUuid: project.primaryNoteUuid,
      priorityEm: project.priorityEm, relatedTasks: [...new Set([...(previous?.relatedTasks || []),
        ...project.relatedTasks, ...taskUuids])], summary: project.summary, uuid: project.uuid });
  });
  const { definitions } = parsedRichFootnotes(quarterlyContent || "");
  const section = planSectionRange(quarterlyContent || "", "Projects");
  const body = section ? quarterlyContent.slice(section.bodyStart, section.end) : "";
  const { blocks } = projectBlocksFromBody(body);
  for (const block of blocks) {
    if (isEmptyProjectPlaceholder(block) || isCompleteMarkedText(block.headingText)) continue;
    const unmarkedTitle = textWithoutBuilderMarker(block.headingText).trim();
    const summary = unmarkedTitle.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\[\^[^\]]+\]/g, "").trim();
    if (projects.some(project => project.summary.toLowerCase() === summary.toLowerCase())) continue;
    if (prospects.some(project => project.summary === summary && !liveProspects.includes(project))) continue;
    const previous = previousProjects.find(project => project.summary === summary);
    const resolvedBody = passageWithResolvedFootnotes(block.body, definitions);
    const rhythm = bulletValueFromBody(resolvedBody, "Weekly rhythm") || "";
    const count = rhythm.match(/\b(one|two|[1-5])\b.*blocks?.*(?:week|weekly)/i);
    const blocksPerWeek = count ? ({ one: 1, two: 2 }[count[1].toLowerCase()] || Number(count[1])) : null;
    const primaryNoteUuid = block.headingText.match(/\/notes\/([\w-]+)/)?.[1] || null;
    const outcome = bulletValueFromBody(resolvedBody, "Outcome");
    projects.push(new QuarterProject({ ...previous, blocksPerWeek, completedTasks: previous?.completedTasks || [],
      deadlineOn: previous?.deadlineOn || null, nextAction: outcome ? `Advance ${ summary }: ${ outcome }` : null,
      preferredWeekdays: previous?.preferredWeekdays || [], primaryNoteUuid, priorityEm: previous?.priorityEm || null,
      relatedTasks: previous?.relatedTasks || [], summary, uuid: previous?.uuid || planningRecordUuid() }));
  }
  return projects;
}
