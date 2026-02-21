/**
 * [Claude-authored file]
 * Created: 2026-02-21 | Model: claude-opus-4-6
 * Task: Mock callPlugin for local dev — provides sample data for all dashboard actions
 * Prompt summary: "global callPlugin mock returning realistic data for init, fetchQuotes, configure, etc."
 */

// Mock callPlugin for local dev — mirrors the actions dispatched by the dashboard app
// eslint-disable-next-line no-unused-vars
async function callPlugin(action, ...args) {
  const app = {
    navigate(url) {
      const isValidAmplenoteNotesUrl = /^https:\/\/www\.amplenote\.com\/notes(?:$|[/?].*)/.test(url);
      if (isValidAmplenoteNotesUrl) {
        console.log("[mock] app.navigate", url);
      } else {
        console.warn("[mock] app.navigate rejected invalid URL", url);
      }
      return isValidAmplenoteNotesUrl;
    }
  };

  switch (action) {

    case "init": {
      const now = new Date();
      const weekStart = _getWeekStart(now);
      return {
        tasks: _generateTasks(weekStart),
        todayTasks: _generateTodayTasks(now),
        completedThisWeek: _generateCompletedTasks(weekStart),
        weeklyVictoryValue: 454,
        dailyVictoryValues: _generateDailyValues(weekStart),
        moodRatings: [
          { rating: 1 }, { rating: 2 }, { rating: 0 },
          { rating: 1 }, { rating: -1 }, { rating: 2 }, { rating: 1 }
        ],
        quarterlyPlans: {
          current: {
            year: now.getFullYear(),
            quarter: Math.ceil((now.getMonth() + 1) / 3),
            label: `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`,
            noteUUID: "mock-quarterly-plan-uuid"
          },
          next: {
            year: now.getFullYear(),
            quarter: Math.ceil((now.getMonth() + 1) / 3) + 1,
            label: `Q${Math.ceil((now.getMonth() + 1) / 3) + 1} ${now.getFullYear()}`,
            noteUUID: null
          }
        },
        currentDate: now.toISOString(),
        settings: {},
        taskDomains: [
          { name: "Work", uuid: "domain-work-uuid" },
          { name: "Personal", uuid: "domain-personal-uuid" },
          { name: "Side Projects", uuid: "domain-side-uuid" }
        ],
        activeTaskDomain: "domain-work-uuid"
      };
    }

    case "fetchQuotes":
      return [
        { text: "What gets measured gets managed.", author: "Peter Drucker" },
        { text: "Small daily improvements lead to stunning results.", author: "Robin Sharma" }
      ];

    case "configure":
      return null;

    case "navigateToNote":
      return app.navigate(`https://www.amplenote.com/notes/${args[0]}`);

    case "navigateToTask":
      return app.navigate(`https://www.amplenote.com/notes/${args[0]}?highlightTaskUUID=${args[1]}`);

    case "navigateToUrl":
      return app.navigate(args[0]);

    case "quickAction":
      return app.navigate(_quickActionToUrl(args[0]));

    case "setActiveTaskDomain": {
      const domainUuid = args[0];
      console.log("[mock] setActiveTaskDomain", domainUuid);
      const now = new Date();
      const weekStart = _getWeekStart(now);
      return {
        tasks: _generateTasks(weekStart),
        todayTasks: _generateTodayTasks(now),
        completedThisWeek: _generateCompletedTasks(weekStart),
        weeklyVictoryValue: Math.floor(Math.random() * 300) + 100,
        dailyVictoryValues: _generateDailyValues(weekStart),
        activeTaskDomain: domainUuid
      };
    }

    case "refreshTaskDomains":
      console.log("[mock] refreshTaskDomains");
      return {
        domains: [
          { name: "Work", uuid: "domain-work-uuid" },
          { name: "Personal", uuid: "domain-personal-uuid" },
          { name: "Side Projects", uuid: "domain-side-uuid" }
        ],
        activeTaskDomain: "domain-work-uuid"
      };

    default:
      console.warn("[mock] unhandled callPlugin action:", action, args);
      return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function _generateDailyValues(weekStart) {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return names.map((day, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const value = Math.floor(Math.random() * 120) + 20;
    return { day, date: d.toISOString(), value, taskCount: Math.floor(value / 30) };
  });
}

function _generateTodayTasks(now) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0).getTime();
  return [
    { uuid: "t1", content: "Review quarterly goals", startAt: base, endAt: base + 3600000, important: true, urgent: false, noteUUID: "note-work-1", noteName: "Work Dashboard Notes" },
    { uuid: "t2", content: "Stand-up meeting", startAt: base + 3600000, endAt: base + 5400000, important: false, urgent: false, noteUUID: "note-work-2", noteName: "Team Meetings" },
    { uuid: "t3", content: "Deep work: feature implementation", startAt: base + 7200000, endAt: base + 14400000, important: true, urgent: true, noteUUID: "note-work-3", noteName: "Feature Backlog" },
    { uuid: "t4", content: "Reply to design feedback", startAt: base + 18000000, endAt: base + 19800000, important: false, urgent: true, noteUUID: "note-work-4", noteName: "Design Review Notes" },
  ];
}

function _generateTasks(weekStart) {
  const tasks = [];
  for (let i = 0; i < 7; i++) {
    const dayStart = new Date(weekStart);
    dayStart.setDate(dayStart.getDate() + i);
    for (let j = 0; j < 3; j++) {
      const startAt = dayStart.getTime() + (9 + j * 2) * 3600000;
      tasks.push({
        uuid: `task-${i}-${j}`,
        content: `Task ${j + 1} for ${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i]}`,
        startAt,
        endAt: startAt + 3600000,
        completedAt: Math.random() > 0.3 ? startAt + 1800000 : null,
        dismissedAt: null,
        victoryValue: Math.floor(Math.random() * 50) + 10,
        important: Math.random() > 0.5,
        urgent: Math.random() > 0.7,
        noteUUID: `note-${i}-${j}`,
        noteName: `Project Notes ${i + 1}`,
      });
    }
  }
  return tasks;
}

function _generateCompletedTasks(weekStart) {
  return _generateTasks(weekStart).filter(t => t.completedAt);
}

function _quickActionToUrl(action) {
  const actionToUrl = {
    dailyJot: "https://www.amplenote.com/notes/jots",
    journal: "https://www.amplenote.com/notes/jots",
    addPerson: "https://www.amplenote.com/notes?tag=people",
    browseCRM: "https://www.amplenote.com/notes?tag=crm"
  };
  return actionToUrl[action] || "https://www.amplenote.com/notes";
}
