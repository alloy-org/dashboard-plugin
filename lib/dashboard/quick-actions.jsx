/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Quick actions widget — list of shortcut buttons
 * Prompt summary: "widget with a 2x2 grid of quick-action buttons (Daily Jot, Journal, etc.)"
 */
import { MdDateRange, MdEdit, MdFeedback, MdMenuBook, MdShuffle } from "react-icons/md";
import WidgetWrapper from "widget-wrapper";
import "styles/quick-actions.scss"

// Buttons in display order, each with the Material icon component it shows
const QUICK_ACTIONS = [
  { action: 'dailyJot', Icon: MdEdit, label: 'Daily Jot' },
  { action: 'journal', Icon: MdMenuBook, label: 'Journal' },
  { action: 'calendar', Icon: MdDateRange, label: 'Calendar' },
  { action: 'randomNote', Icon: MdShuffle, label: 'Random Note' },
  { action: 'leaveFeedback', Icon: MdFeedback, label: 'Leave Feedback' },
];

const QUICK_ACTION_URLS = {
  dailyJot: "https://www.amplenote.com/notes/jots",
  journal:  "https://www.amplenote.com/notes/jots",
  calendar: "https://www.amplenote.com/notes/calendar",
  leaveFeedback: "https://www.amplenote.com/plugins/HXRa7ADW88bnyfA7hDwbXSLY",
};

// ------------------------------------------------------------------------------------------
// @desc Run one quick action. Most actions are plain navigations resolved through QUICK_ACTION_URLS;
//   randomNote carries its own behavior instead of a destination URL.
// @param {Object} params - An object with the following properties:
// - {string} action - Action key taken from a QUICK_ACTIONS entry
// - {Object} app - Amplenote app object, used for app.navigate and task-domain lookups
async function performQuickAction({ action, app }) {
  if (action === 'randomNote') return randomNote(app);
  const url = QUICK_ACTION_URLS[action];
  if (url) await app.navigate(url);
}

// [Claude] Task: pick a random note from user's task domains and navigate to it
// Prompt: "non-API methods on app should be standalone functions using only real API methods"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// [Claude] Task: guard against missing domain entries when collecting notes for random pick
// Prompt: "wrap each component load in try...catch so failure to render one widget does not disrupt others"
// Date: 2026-03-21 | Model: claude-4.6-opus-high-thinking
async function randomNote(app) {
  let domains;
  try {
    domains = await app.getTaskDomains();
  } catch (err) {
    return;
  }
  const allNotes = (Array.isArray(domains) ? domains : [])
    .filter(d => d != null)
    .flatMap(d => d.notes || []);
  if (!allNotes.length) return;
  const pick = allNotes[Math.floor(Math.random() * allNotes.length)];
  if (pick?.uuid) await app.navigate(`https://www.amplenote.com/notes/${pick.uuid}`);
}

// ------------------------------------------------------------------------------------------
// @desc List of dashboard shortcut buttons, drawn like rows of a host app menu. Action routing lives in
//   module-level helpers so this stays a render-only component.
// @param {Object} app - Amplenote app object, forwarded to the action handlers
// [Claude] Task: use app.navigate (real API) instead of non-API convenience methods
// Prompt: "non-API methods on app should be standalone functions"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// [Claude claude-4.7-opus] Task: migrate QuickActionsWidget from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function QuickActionsWidget({ app }) {
  const handleAction = (action) => performQuickAction({ action, app });

  return (
    <WidgetWrapper widgetId="quick-actions">
      <div className="qa-grid">
        {QUICK_ACTIONS.map(quickAction => (
          <button
            key={quickAction.action}
            className="qa-button"
            onClick={() => handleAction(quickAction.action)}
            type="button"
          >
            <quickAction.Icon className="qa-icon" />
            <span className="qa-label">{quickAction.label}</span>
          </button>
        ))}
      </div>
    </WidgetWrapper>
  );
}
