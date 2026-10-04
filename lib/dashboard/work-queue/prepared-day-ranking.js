// Let a widget whose cache is cold have the day's shared ranking prepared by the Dashboard's work queue, instead of
// sending its own ranking request beside the queue's. The widget submits the day's preparation as foreground data, so
// it starts at once, its provider requests are served ahead of maintenance, and new maintenance waits until it ends;
// a preparation already queued for that day is coalesced rather than repeated. Once the preparation finishes, the
// widget ranks as before and finds the ranking stored. Waiting never fails the widget: when the queue cannot run the
// preparation, or it takes too long, the widget goes on and ranks the day itself.
import { dayRankingRequest } from "dashboard/work-queue/jobs/prepare-day-ranking";
import { cancelWorkTimer, startWorkTimer } from "dashboard/work-queue/work-timers";
import { dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

// The longest a widget waits for the queue's preparation before ranking the day itself. A ranking request rarely takes
// this long, so reaching it usually means another session holds the job.
export const PREPARED_RANKING_WAIT_MILLISECONDS = 45 * 1000;

// ----------------------------------------------------------------------------------------------
// @desc Create the function a widget calls before ranking a day on a cache miss.
// @param {DurableWorkRunner|null} durable - The Dashboard runtime's durable runner; null when durable work is off.
// @param {object} [options] - { clearTimer = cancelWorkTimer, clock = Date.now, setTimer = startWorkTimer,
//   waitMilliseconds = PREPARED_RANKING_WAIT_MILLISECONDS }.
// @returns {function|null} async ({ domainName, domainUuid, targetDate }) => { status }, status being the
//   preparation's outcome ("completed", "failed", "retryWaiting", "blockedConfiguration", "superseded"), "notQueued"
//   when the queue left it unrun, "timedOut", or "unavailable" when it could not be submitted. It never rejects.
//   Null without a durable runner.
export function preparedDayRankingAwaiter(durable, { clearTimer = cancelWorkTimer, clock = Date.now, setTimer = startWorkTimer,
    waitMilliseconds = PREPARED_RANKING_WAIT_MILLISECONDS } = {}) {
  if (!durable) return null;
  return ({ domainName, domainUuid, targetDate }) => {
    const request = dayRankingRequest({ dateKey: dateKeyFromDateInput(targetDate), domainName, domainUuid },
      { category: "foregroundData", requestedAt: clock() });
    return new Promise(resolve => {
      let settled = false;
      let timer = null;
      let unsubscribeScheduler = () => {};
      const finish = status => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        unsubscribeOutcomes();
        unsubscribeScheduler();
        logIfEnabled("[prepared-day-ranking] preparation finished waiting", { jobKey: request.key, status });
        resolve({ status });
      };
      const unsubscribeOutcomes = durable.subscribeOutcomes(outcome => {
        if (outcome.jobKey === request.key) finish(outcome.status);
      });
      const finishUnlessQueued = () => {
        if (!durable.scheduler.holds(request.key)) finish("notQueued");
      };
      timer = setTimer(() => finish("timedOut"), waitMilliseconds);
      durable.submit(request).then(() => {
        if (settled) return;
        unsubscribeScheduler = durable.scheduler.subscribe(finishUnlessQueued);
        finishUnlessQueued();
      }, error => {
        logIfEnabled("[prepared-day-ranking] could not submit the preparation", error?.message);
        finish("unavailable");
      });
    });
  };
}
