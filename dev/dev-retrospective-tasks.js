// Completed tasks from the quarter before the current one, so the dev dashboard has a Quarter Retrospective to
// generate. The tasks cluster around three themes, each kept in its own note, so the month digests and theme
// inference have projects to find. A lighter version of the same work fills the quarter before that, so the
// retrospective has a quarter to compare against. Only the Node dev app imports this file, so it never reaches the production build.

// One note per theme. findNote falls back to these, since they have no markdown file in the dev notes directory.
export const RETROSPECTIVE_NOTE_HANDLES = [
  { name: "Etsy Spell Shop Launch", uuid: "note-retrospective-etsy-shop" },
  { name: "Get Outdoors More", uuid: "note-retrospective-outdoors" },
  { name: "Microsoft AI Measurement Engagement", uuid: "note-retrospective-microsoft-ai" },
];

const [ETSY_NOTE, OUTDOORS_NOTE, MICROSOFT_NOTE] = RETROSPECTIVE_NOTE_HANDLES.map(handle => handle.uuid);

// [noteUuid, monthOfQuarter (0-2), dayOfMonth, hour, content, victoryValue, minutes (0 = never scheduled), important]
const RETROSPECTIVE_TASK_ROWS = [
  [ETSY_NOTE, 0, 2, 10, "Pick a name for the Etsy spell shop", 3, 30, false],
  [ETSY_NOTE, 0, 5, 14, "Open the Etsy seller account and set up payouts", 5, 45, true],
  [ETSY_NOTE, 0, 9, 19, "Agree on triple-cast pricing with the coven", 6, 60, false],
  [ETSY_NOTE, 0, 13, 11, "Photograph the first five spell scrolls in natural light", 4, 90, false],
  [ETSY_NOTE, 0, 18, 16, "Write listing copy for the Protection Triple-Cast", 4, 45, false],
  [ETSY_NOTE, 0, 24, 20, "Draft the shop's refund policy for spells that don't take", 3, 30, false],
  [ETSY_NOTE, 1, 1, 9, "Design the shop banner and logo", 5, 120, false],
  [ETSY_NOTE, 1, 6, 15, "Order wax seals and parchment for packaging", 2, 0, false],
  [ETSY_NOTE, 1, 11, 21, "Cast the first batch of Prosperity spells with the coven", 8, 180, true],
  [ETSY_NOTE, 1, 15, 13, "Publish the first eight listings", 7, 60, true],
  [ETSY_NOTE, 1, 22, 10, "Answer the first customer's question about moon phases", 2, 15, false],
  [ETSY_NOTE, 1, 27, 17, "Ship the first order", 6, 30, false],
  [ETSY_NOTE, 2, 3, 12, "Set up Etsy ads with a $5 daily budget", 3, 30, false],
  [ETSY_NOTE, 2, 8, 19, "Add a Harvest Moon bundle for autumn", 5, 60, false],
  [ETSY_NOTE, 2, 14, 11, "Ask the first ten buyers for reviews", 3, 20, false],
  [ETSY_NOTE, 2, 19, 20, "Reconcile the quarter's shop sales with the coven's ledger", 4, 45, false],
  [ETSY_NOTE, 2, 25, 15, "Plan the Samhain restock with the coven", 5, 60, false],
  [OUTDOORS_NOTE, 0, 4, 7, "Buy trail shoes", 2, 0, false],
  [OUTDOORS_NOTE, 0, 6, 8, "Hike Mount Si with Dana", 6, 300, true],
  [OUTDOORS_NOTE, 0, 12, 18, "Plan a weekly Thursday evening walk route", 2, 30, false],
  [OUTDOORS_NOTE, 0, 20, 7, "Kayak Lake Union at sunrise", 5, 150, false],
  [OUTDOORS_NOTE, 0, 27, 9, "Join the neighborhood trail cleanup", 4, 180, false],
  [OUTDOORS_NOTE, 1, 3, 6, "Reserve a campsite at Lake Wenatchee", 3, 20, false],
  [OUTDOORS_NOTE, 1, 9, 17, "Camp two nights at Lake Wenatchee", 8, 0, true],
  [OUTDOORS_NOTE, 1, 17, 7, "Bike the Burke-Gilman trail end to end", 6, 240, false],
  [OUTDOORS_NOTE, 1, 24, 18, "Take the dog to the off-leash beach", 2, 90, false],
  [OUTDOORS_NOTE, 2, 1, 8, "Pick blackberries along the Sammamish River", 3, 120, false],
  [OUTDOORS_NOTE, 2, 7, 7, "Hike Rattlesnake Ledge before work", 4, 150, false],
  [OUTDOORS_NOTE, 2, 13, 10, "Teach the kids to pitch a tent in the backyard", 4, 90, false],
  [OUTDOORS_NOTE, 2, 21, 8, "Walk the Discovery Park loop for the larch colors", 3, 120, false],
  [OUTDOORS_NOTE, 2, 28, 9, "Log the quarter's 23 days outside", 2, 15, false],
  [MICROSOFT_NOTE, 0, 3, 13, "Kickoff call with Microsoft's AI productivity team", 5, 60, true],
  [MICROSOFT_NOTE, 0, 8, 10, "Define the AI-assisted commit metrics for the pilot", 7, 180, true],
  [MICROSOFT_NOTE, 0, 16, 14, "Get repository access approved for the pilot teams", 4, 45, false],
  [MICROSOFT_NOTE, 0, 23, 9, "Write the data handling agreement summary", 5, 120, false],
  [MICROSOFT_NOTE, 0, 30, 15, "Baseline code churn for the six pilot repositories", 6, 150, false],
  [MICROSOFT_NOTE, 1, 5, 11, "Classify Copilot-authored lines in the first sample", 7, 240, false],
  [MICROSOFT_NOTE, 1, 12, 14, "Present early duplication findings to the Microsoft team", 8, 60, true],
  [MICROSOFT_NOTE, 1, 19, 10, "Fix the moved-code detector's false positives", 6, 180, false],
  [MICROSOFT_NOTE, 1, 26, 13, "Add a test-coverage delta to the AI impact report", 5, 120, false],
  [MICROSOFT_NOTE, 2, 2, 9, "Interview four pilot engineers about review load", 4, 120, false],
  [MICROSOFT_NOTE, 2, 9, 15, "Compare defect rates before and after AI adoption", 7, 180, true],
  [MICROSOFT_NOTE, 2, 16, 11, "Draft the AI measurement findings report", 8, 240, true],
  [MICROSOFT_NOTE, 2, 22, 14, "Revise the report after Microsoft's legal review", 5, 90, false],
  [MICROSOFT_NOTE, 2, 29, 10, "Deliver the final AI measurement readout", 9, 60, true],
];

// Every fifth row is left out of the quarter before, and each kept row is worth one less Victory Value there.
const EARLIER_QUARTER_SKIPPED_ROW_INTERVAL = 5;

// ----------------------------------------------------------------------------------------------
// @desc Build the fixture's completed tasks: the full set dated within the quarter before the one containing
//   nowSeconds, so the fixture always describes "last quarter" whenever the dev server starts, and a lighter set in the
//   quarter before that, for the retrospective to compare with. Each task was created a few days before it was
//   completed, and a task with minutes was scheduled to end the hour it was completed in.
// @param {number} nowSeconds - The current time in Unix seconds.
// @returns {Array<object>} Completed tasks in the shape getCompletedTasks returns.
export function buildRetrospectiveTasks(nowSeconds) {
  const now = new Date(nowSeconds * 1000);
  const currentQuarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
  const previousQuarterStart = new Date(now.getFullYear(), currentQuarterStartMonth - 3, 1);
  const earlierQuarterStart = new Date(now.getFullYear(), currentQuarterStartMonth - 6, 1);
  const previousQuarterTasks = RETROSPECTIVE_TASK_ROWS.map((row, index) => _fixtureTask(row, index, { quarterStart: previousQuarterStart,
    uuidPrefix: "dev-retrospective", victoryValueOffset: 0 }));
  const earlierRows = RETROSPECTIVE_TASK_ROWS.filter((row, index) => index % EARLIER_QUARTER_SKIPPED_ROW_INTERVAL !== 0);
  const earlierQuarterTasks = earlierRows.map((row, index) => _fixtureTask(row, index, { quarterStart: earlierQuarterStart,
    uuidPrefix: "dev-retrospective-earlier", victoryValueOffset: -1 }));
  return [...earlierQuarterTasks, ...previousQuarterTasks];
}

// ----------------------------------------------------------------------------------------------
// @desc One fixture row as a completed task within the quarter starting at quarterStart.
// @param {Array} row - A RETROSPECTIVE_TASK_ROWS row.
// @param {number} index - The row's position, which numbers the task's uuid and staggers its creation.
// @param {object} options - { quarterStart, uuidPrefix, victoryValueOffset }; the offset is added to the row's Victory
//   Value, which stays at least 1.
// @returns {object} A completed task in the shape getCompletedTasks returns.
function _fixtureTask(row, index, { quarterStart, uuidPrefix, victoryValueOffset }) {
  const [noteUuid, monthOfQuarter, dayOfMonth, hour, content, victoryValue, minutes, important] = row;
  const completedDate = new Date(quarterStart.getFullYear(), quarterStart.getMonth() + monthOfQuarter, dayOfMonth, hour, 30);
  const completedAt = Math.floor(completedDate.getTime() / 1000);
  const endAt = minutes ? completedAt : null;
  const startAt = minutes ? completedAt - minutes * 60 : null;
  return { completedAt, content, createdAt: completedAt - (3 + (index % 9)) * 86400, endAt, important, noteUUID: noteUuid, startAt,
    uuid: `${ uuidPrefix }-${ index + 1 }`, victoryValue: Math.max(1, victoryValue + victoryValueOffset) };
}
