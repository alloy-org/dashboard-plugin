// Derive quarterly project identities, task associations, and completion evidence for agenda suggestions.
import { planningRecordUuid } from "plan-wizard/plan-models";
import { bulletValueFromBody, isEmptyProjectPlaceholder, planSectionRange, projectBlocksFromBody,
  textWithoutBuilderMarker } from "plan-wizard/quarterly-plan-markdown";
import { parsedRichFootnotes, passageWithResolvedFootnotes } from "util/amplenote-rich-footnotes";
import { dateFromDateInput, dateKeyFromDateInput } from "util/date-utility";

// ----------------------------------------------------------------------------------------------
// @desc Match a task through stored UUIDs, its primary project note, explicit project links, or the full project name.
// @param {object} project - Persisted project identity and source references.
// @param {object} task - Native task or compact agenda candidate.
// @returns {boolean} Whether the association has concrete source evidence.
export function projectMatchesTask(project, task) {
  const content = task.content || task.taskText || "";
  const taskUuid = task.uuid || task.taskUuid;
  if (project.relatedTasks.includes(taskUuid)) return true;
  if (project.primaryNoteUuid && (task.noteUUID || task.noteUuid) === project.primaryNoteUuid) return true;
  if (content.includes(`project:${ project.uuid }`)) return true;
  if (project.primaryNoteUuid && content.includes(`/notes/${ project.primaryNoteUuid }`)) return true;
  const escaped = project.summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\W)${ escaped }(?:$|\\W)`, "i").test(content);
}

// ----------------------------------------------------------------------------------------------
// @desc Count actual completions before the selected day's end, using a rolling week and Monday-based pace window.
// @param {object} project - Project with completedTasks, each carrying taskUuid and completedAt.
// @param {Date} targetDate - Local date being planned.
// @returns {object} Evidence and urgency; completed tasks are a proxy for blocks, never a measure of time spent.
export function projectProgressEvidence(project, targetDate) {
  const endDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 1);
  const weekStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() - (targetDate.getDay() + 6) % 7);
  const rollingStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() - 6);
  const distinctCompletions = new Map(project.completedTasks.map(task => [task.sourceTaskUuid || task.taskUuid, task]));
  const completionDates = [...distinctCompletions.values()].map(task => dateFromDateInput(task.completedAt));
  const priorCompletions = completionDates.filter(date => date < endDate);
  const completedThisWeek = priorCompletions.filter(date => date >= weekStart).length;
  const completedPastWeek = priorCompletions.filter(date => date >= rollingStart).length;
  const blocksPerWeek = project.blocksPerWeek;
  const monthKey = dateKeyFromDateInput(targetDate).slice(0, 7);
  const inFocus = !project.focusMonths?.length || project.focusMonths.includes(monthKey);
  const due = inFocus && (completedPastWeek === 0 || (blocksPerWeek && completedThisWeek < blocksPerWeek));
  const reason = blocksPerWeek
    ? `You chose ${ blocksPerWeek } blocks per week and have completed ${ completedThisWeek } related task(s) so far this week.`
    : `No related task has been completed in the past week for ${ project.summary }.`;
  return { blocksPerWeek, completedPastWeek, completedThisWeek, due: !!due, reason,
    weekStart: dateKeyFromDateInput(weekStart) };
}

// ----------------------------------------------------------------------------------------------
// @desc Merge actual task observations without deleting older completion evidence that has aged out of API queries.
// @param {object} project - Project record.
// @param {Array<object>} tasks - Native tasks, including completions and reopened or dismissed tasks.
// @returns {object} Project with unique task identities and authoritative completion timestamps.
export function projectWithTaskEvidence(project, tasks) {
  const relatedTasks = new Set(project.relatedTasks);
  const completedByUuid = new Map((project.completedTasks || []).map(task => [task.taskUuid, task]));
  for (const task of tasks) {
    if (!task.uuid || !projectMatchesTask(project, task)) continue;
    relatedTasks.add(task.uuid);
    if (task.completedAt && !task.dismissedAt) {
      const completedDate = dateFromDateInput(task.completedAt, { throwOnInvalid: false });
      const sourceTaskUuid = task.content?.match(/\/notes\/tasks\/([\w-]+)/)?.[1] || null;
      if (completedDate) completedByUuid.set(task.uuid, { completedAt: completedDate.toISOString(), sourceTaskUuid, taskUuid: task.uuid });
    } else completedByUuid.delete(task.uuid);
  }
  return { ...project, completedTasks: [...completedByUuid.values()], relatedTasks: [...relatedTasks] };
}

// ----------------------------------------------------------------------------------------------
// @desc Reuse Plan Builder UUIDs and retain generated identities for projects authored directly in Quarterly Goals.
// @param {object} options - { guide, previousProjects, quarterlyContent, scope }.
// @returns {Array<object>} Active projects, retaining old records separately at the storage layer.
export function quarterlyProgressProjects({ guide, previousProjects, quarterlyContent, scope }) {
  const envelopes = [guide?.workProspects, guide?.personalProspects].filter(Boolean);
  const prospects = envelopes.flatMap(envelope => envelope.prospects || []);
  const liveProspects = prospects.filter(project => project.quarterKey === scope.quarterKey
    && !["humanRejected", "humanRetired"].includes(project.approvalStatusEm)
    && ["quarterFocus", "monthFocus", "stayWarm"].includes(project.priorityEm));
  const projects = liveProspects.map(project => {
    const previous = previousProjects.find(record => record.uuid === project.uuid || record.summary === project.summary);
    const linkedTasks = envelopes.flatMap(envelope => envelope.prospectTasks || []);
    const acceptedTasks = linkedTasks.filter(task => task.prospectUuid === project.uuid && task.approvalStatus !== "humanRejected");
    const taskUuids = acceptedTasks.map(task => task.taskUuid).filter(Boolean);
    const blocksPerWeek = { oneSubstantialBlock: 1, smallMoveMostDays: 5, twoFocusedBlocks: 2 }[project.paceEm] || null;
    return { ...previous, blocksPerWeek, completedTasks: previous?.completedTasks || [],
      focusMonths: project.focusMonths, paceEm: project.paceEm, preferredWeekdays: project.preferredWeekdays,
      nextAction: acceptedTasks.find(task => !task.taskUuid && !task.completedAt)?.taskText || null,
      primaryNoteUuid: project.primaryNoteUuid, relatedTasks: [...new Set([...(previous?.relatedTasks || []),
        ...project.relatedTasks, ...taskUuids])], summary: project.summary, uuid: project.uuid };
  });
  const { definitions } = parsedRichFootnotes(quarterlyContent || "");
  const section = planSectionRange(quarterlyContent || "", "Projects");
  const body = section ? quarterlyContent.slice(section.bodyStart, section.end) : "";
  const { blocks } = projectBlocksFromBody(body);
  for (const block of blocks) {
    if (isEmptyProjectPlaceholder(block)) continue;
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
    projects.push({ ...previous, blocksPerWeek, completedTasks: previous?.completedTasks || [],
      nextAction: outcome ? `Advance ${ summary }: ${ outcome }` : null, primaryNoteUuid,
      relatedTasks: previous?.relatedTasks || [], summary, uuid: previous?.uuid || planningRecordUuid() });
  }
  return projects;
}
