// Decide when a mounted Dashboard prepares the day's shared suggestion ranking in the background. Project rankings,
// ideas, and idea ratings change the candidates a day is ranked from, so the preparation waits until the visit's
// project jobs have all finished and nothing has finished for a quiet period: a burst of project updates leads to one
// preparation, not one per project. A reconciliation that finds nothing to do leads to a preparation only when
// something changed since the last one or the day has turned. The preparation covers the current day and, once the
// agenda has moved on to a later working day, that day too.
import { resolveProposedAgendaDate } from "dashboard/proposed-agenda-service";
import { GENERATE_PROJECT_IDEAS_JOB_TYPE, RANK_PROJECT_TASKS_JOB_TYPE, RATE_PROJECT_IDEAS_JOB_TYPE,
  RECONCILE_PROJECTS_JOB_TYPE } from "dashboard/work-queue/jobs/project-job-requests";
import { cancelWorkTimer, startWorkTimer } from "dashboard/work-queue/work-timers";
import { dateKeyFromDateInput } from "util/date-utility";

// How long after the last project job finishes before the day is prepared.
export const DAY_PREPARATION_QUIET_MILLISECONDS = 30 * 1000;
// Job types whose completion changes the candidates a day is ranked from.
const CANDIDATE_JOB_TYPES = [GENERATE_PROJECT_IDEAS_JOB_TYPE, RANK_PROJECT_TASKS_JOB_TYPE, RATE_PROJECT_IDEAS_JOB_TYPE];

// ----------------------------------------------------------------------------------------------
// @desc The days a background preparation ranks: the current day, and the agenda's day when it has moved on.
// @param {Date} now - Current time.
// @returns {Array<string>} YYYY-MM-DD days, the current day first.
export function dayPreparationDateKeys(now) {
  const todayKey = dateKeyFromDateInput(now);
  const agendaKey = dateKeyFromDateInput(resolveProposedAgendaDate(now));
  return agendaKey === todayKey ? [todayKey] : [todayKey, agendaKey];
}

// ----------------------------------------------------------------------------------------------
// @desc Watches durable job outcomes and asks for the day's preparation at the moments described above.
export default class DayPreparationTrigger {
  clearTimer; // {function} Cancels a timer from setTimer.
  clock; // {function} Returns epoch milliseconds; injected for tests.
  disposed = false; // {boolean} True once disposed; nothing further is submitted.
  inFlight; // {function} Returns how many of the visit's project jobs have neither finished nor failed.
  preparedDateKeys = null; // {string|null} The days the last preparation covered, joined.
  quietMilliseconds; // {number} How long to wait after the last project job finishes.
  setTimer; // {function} (callback, milliseconds) => timer.
  stale = true; // {boolean} Whether candidates may have changed since the last preparation.
  submit; // {function} (dateKeys) => void, submitting a preparation for each day.
  timer = null; // {*} The pending preparation's timer, or null.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a trigger.
  // @param {object} options - { clearTimer = cancelWorkTimer, clock = Date.now, inFlight,
  //   quietMilliseconds = DAY_PREPARATION_QUIET_MILLISECONDS, setTimer = startWorkTimer, submit }.
  constructor({ clearTimer = cancelWorkTimer, clock = Date.now, inFlight, quietMilliseconds = DAY_PREPARATION_QUIET_MILLISECONDS,
    setTimer = startWorkTimer, submit }) {
    Object.assign(this, { clearTimer, clock, inFlight, quietMilliseconds, setTimer, submit });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Cancel a pending preparation and submit nothing further.
  dispose() {
    this.disposed = true;
    this._cancelTimer();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Take note of one durable outcome. A project job or reconciliation outcome restarts the quiet period while no
  //   project job is in flight and the days need preparing; while one is in flight, the next outcome decides.
  // @param {object} outcome - { jobType, status }, as DurableWorkRunner#subscribeOutcomes reports.
  observeOutcome({ jobType, status }) {
    const candidateJob = CANDIDATE_JOB_TYPES.includes(jobType);
    if (this.disposed || (!candidateJob && jobType !== RECONCILE_PROJECTS_JOB_TYPE)) return;
    if (candidateJob && status === "completed") this.stale = true;
    this._cancelTimer();
    if (this.inFlight() > 0 || !this._preparationDue()) return;
    this.timer = this.setTimer(() => this._prepare(), this.quietMilliseconds);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Cancel the pending preparation's timer, if any.
  _cancelTimer() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Submit the preparation once the quiet period passes, unless a project job started meanwhile.
  _prepare() {
    this.timer = null;
    if (this.disposed || this.inFlight() > 0) return;
    const dateKeys = dayPreparationDateKeys(new Date(this.clock()));
    this.preparedDateKeys = dateKeys.join(",");
    this.stale = false;
    this.submit(dateKeys);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Whether candidates may have changed since the last preparation, or the days it covered have changed.
  // @returns {boolean} True when a preparation is due.
  _preparationDue() {
    return this.stale || dayPreparationDateKeys(new Date(this.clock())).join(",") !== this.preparedDateKeys;
  }
}
