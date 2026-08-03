/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Quick actions widget — grid of shortcut buttons
 * Prompt summary: "widget with a 2x2 grid of quick-action buttons (Daily Jot, Journal, etc.)"
 */
import WidgetWrapper from "widget-wrapper";
import "styles/quick-actions.scss"

const QUICK_ACTION_URLS = {
  dailyJot: "https://www.amplenote.com/notes/jots",
  journal:  "https://www.amplenote.com/notes/jots",
  calendar: "https://www.amplenote.com/notes/calendar",
  leaveFeedback: "https://www.amplenote.com/plugins/HXRa7ADW88bnyfA7hDwbXSLY",
};

// ------------------------------------------------------------------------------------------
// @desc Run one quick action. Most actions are plain navigations resolved through QUICK_ACTION_URLS;
//   randomNote and swapBackground carry their own behavior instead of a destination URL.
// @param {Object} params - An object with the following properties:
// - {string} action - Action key taken from a quickActionDescriptors entry
// - {Object} app - Amplenote app object, used for app.navigate and task-domain lookups
// - {function(): void} [onSwapBackground] - Dashboard-supplied background cross-fade trigger, when available
async function performQuickAction({ action, app, onSwapBackground }) {
  if (action === 'randomNote') return randomNote(app);
  if (action === 'swapBackground') return onSwapBackground?.();
  const url = QUICK_ACTION_URLS[action];
  if (url) await app.navigate(url);
}

// ------------------------------------------------------------------------------------------
// @desc Build the ordered button list for the widget. The background swap is only offered when the
//   dashboard passed down a swap handler, so surfaces that render this widget outside the dashboard grid
//   (the memory-measurement popup, which has no background of its own) do not show an inert button.
// @param {boolean} canSwapBackground - Whether an onSwapBackground handler was supplied
// @returns {Array<Object>} Button descriptors, each with { action, icon, label }
function quickActionDescriptors(canSwapBackground) {
  const descriptors = [
    { label: 'Daily Jot',    icon: '📝', action: 'dailyJot' },
    { label: 'Journal',      icon: '📓', action: 'journal' },
    { label: 'Calendar',     icon: '📅', action: 'calendar' },
    { label: 'Random Note',  icon: '🎲', action: 'randomNote' },
  ];
  if (canSwapBackground) descriptors.push({ label: 'Swap Background', icon: '🖼️', action: 'swapBackground' });
  descriptors.push({ label: 'Leave Feedback', icon: '💬', action: 'leaveFeedback' });
  return descriptors;
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
// @desc Grid of dashboard shortcut buttons. Action routing and the button list live in module-level
//   helpers so this stays a render-only component.
// @param {Object} app - Amplenote app object, forwarded to the action handlers
// @param {function(): void} [onSwapBackground] - Dashboard background cross-fade trigger; when omitted,
//   the Swap Background button is left out of the grid entirely
// [Claude] Task: use app.navigate (real API) instead of non-API convenience methods
// Prompt: "non-API methods on app should be standalone functions"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// [Claude claude-4.7-opus] Task: migrate QuickActionsWidget from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function QuickActionsWidget({ app, onSwapBackground }) {
  const actions = quickActionDescriptors(typeof onSwapBackground === 'function');
  const handleAction = (action) => performQuickAction({ action, app, onSwapBackground });

  return (
    <WidgetWrapper widgetId="quick-actions">
      <div className="qa-grid">
        {actions.map(a => (
          <button
            key={a.action}
            className="qa-button"
            onClick={() => handleAction(a.action)}
          >
            <span className="qa-icon">{a.icon}</span>
            <span className="qa-label">{a.label}</span>
          </button>
        ))}
      </div>
    </WidgetWrapper>
  );
}
