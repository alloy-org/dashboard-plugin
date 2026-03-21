/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Quick actions widget — grid of shortcut buttons
 * Prompt summary: "widget with a 2x2 grid of quick-action buttons (Daily Jot, Journal, etc.)"
 */
import { widgetTitleFromId } from "constants/settings";
import { createElement } from "react";
import WidgetWrapper from "widget-wrapper";
import "styles/quick-actions.scss"

const QUICK_ACTION_URLS = {
  dailyJot: "https://www.amplenote.com/notes/jots",
  journal:  "https://www.amplenote.com/notes/jots",
  calendar: "https://www.amplenote.com/notes/calendar",
};

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

// [Claude] Task: use app.navigate (real API) instead of non-API convenience methods
// Prompt: "non-API methods on app should be standalone functions"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export default function QuickActionsWidget({ app }) {
  const h = createElement;

  const actions = [
    { label: 'Daily Jot',    icon: '📝', action: 'dailyJot' },
    { label: 'Journal',      icon: '📓', action: 'journal' },
    { label: 'Calendar',     icon: '📅', action: 'calendar' },
    { label: 'Random Note',  icon: '🎲', action: 'randomNote' }
  ];

  const handleAction = async (action) => {
    if (action === 'randomNote') {
      await randomNote(app);
      return;
    }
    const url = QUICK_ACTION_URLS[action];
    if (url) await app.navigate(url);
  };

  return h(WidgetWrapper, { title: widgetTitleFromId('quick-actions'), icon: '⚡', widgetId: 'quick-actions' },
    h('div', { className: 'qa-grid' },
      actions.map(a => h('button', {
        key: a.action,
        className: 'qa-button',
        onClick: () => handleAction(a.action)
      },
        h('span', { className: 'qa-icon' }, a.icon),
        h('span', { className: 'qa-label' }, a.label)
      ))
    )
  );
}
