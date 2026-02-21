(() => {
  // client-bundle:client-bundle
  var clientBundle = `(() => {
  // react-global:react
  var R = globalThis.React;
  var react_default = R;
  var createElement = R.createElement;
  var useState = R.useState;
  var useEffect = R.useEffect;
  var useRef = R.useRef;
  var useCallback = R.useCallback;
  var useMemo = R.useMemo;

  // react-global:react-dom
  var RD = globalThis.ReactDOM;
  var react_dom_default = RD;
  var createRoot = RD.createRoot;

  // lib/dashboard/widget-wrapper.js
  function WidgetWrapper({ title, icon, widgetId, configurable, children }) {
    const h = react_default.createElement;
    const handleConfigure = async () => {
      const result = await callPlugin("configure", widgetId);
      if (result)
        window.location.reload();
    };
    return h(
      "div",
      { className: "widget widget-" + widgetId },
      h(
        "div",
        { className: "widget-header" },
        h("span", { className: "widget-icon" }, icon),
        h("h3", { className: "widget-title" }, title),
        configurable ? h("button", { className: "widget-configure", onClick: handleConfigure }, "\\u2699 Configure") : null
      ),
      h("div", { className: "widget-body" }, children)
    );
  }

  // lib/dashboard/planning.js
  function PlanningWidget({ quarterlyPlans }) {
    const h = react_default.createElement;
    const [activeTab, setActiveTab] = react_default.useState((/* @__PURE__ */ new Date()).getMonth());
    const handleOpenPlan = async (plan) => {
      if (plan.noteUUID) {
        await callPlugin("navigateToNote", plan.noteUUID);
      } else {
        await callPlugin("createQuarterlyPlan", {
          label: plan.label,
          year: plan.year,
          quarter: plan.quarter
        });
      }
    };
    const months = _getQuarterMonths(quarterlyPlans.current, quarterlyPlans.next);
    return h(
      WidgetWrapper,
      { title: "Planning", icon: "\\u{1F4CB}", widgetId: "planning" },
      h(
        "div",
        { className: "planning-quarters" },
        [quarterlyPlans.current, quarterlyPlans.next].map(
          (plan) => h(
            "div",
            { key: plan.label, className: "quarter-card", onClick: () => handleOpenPlan(plan) },
            h("span", { className: "quarter-label" }, plan.label),
            h(
              "span",
              { className: "quarter-status" },
              plan.noteUUID ? "\\u{1F4DD} Open Plan" : "+ Create Plan"
            )
          )
        )
      ),
      h(
        "div",
        { className: "month-tabs" },
        months.map(
          (m) => h("button", {
            key: m.index,
            className: "month-tab" + (m.index === activeTab ? " active" : ""),
            onClick: () => setActiveTab(m.index)
          }, m.short)
        )
      )
    );
  }
  function _getQuarterMonths(current, next) {
    const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const startMonth = (current.quarter - 1) * 3;
    const months = [];
    for (let i = 0; i < 6; i++) {
      const idx = (startMonth + i) % 12;
      months.push({ index: idx, short: MONTH_NAMES[idx] });
    }
    return months;
  }

  // lib/dashboard/victory-value.js
  function VictoryValueWidget({ dailyValues, weeklyTotal, moodRatings, settings }) {
    const h = createElement;
    const canvasRef = useRef(null);
    const maxValue = Math.max(...dailyValues.map((d) => d.value), 1);
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas)
        return;
      const ctx = canvas.getContext("2d");
      const W = canvas.width = canvas.offsetWidth * 2;
      const H = canvas.height = canvas.offsetHeight * 2;
      ctx.scale(2, 2);
      const w = W / 2, ht = H / 2;
      const barW = (w - 80) / 7;
      const chartH = ht - 50;
      ctx.clearRect(0, 0, w, ht);
      dailyValues.forEach((d, i) => {
        const barH = d.value / maxValue * chartH * 0.85;
        const x = 40 + i * barW + barW * 0.15;
        const y = chartH - barH + 10;
        ctx.fillStyle = d.value > 0 ? "#6366f1" : "#e5e7eb";
        ctx.beginPath();
        ctx.roundRect(x, y, barW * 0.7, barH, [4, 4, 0, 0]);
        ctx.fill();
        ctx.fillStyle = "#6b7280";
        ctx.font = "11px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(d.day, x + barW * 0.35, ht - 12);
        if (d.value > 0) {
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 10px system-ui";
          ctx.fillText(d.value, x + barW * 0.35, y + 14);
        }
      });
      if (moodRatings && moodRatings.length > 0) {
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        moodRatings.forEach((m, i) => {
          const normalizedY = chartH - (m.rating + 2) / 4 * chartH + 10;
          const x = 40 + i * barW + barW * 0.5;
          i === 0 ? ctx.moveTo(x, normalizedY) : ctx.lineTo(x, normalizedY);
        });
        ctx.stroke();
        moodRatings.forEach((m, i) => {
          const normalizedY = chartH - (m.rating + 2) / 4 * chartH + 10;
          const x = 40 + i * barW + barW * 0.5;
          ctx.fillStyle = "#f59e0b";
          ctx.beginPath();
          ctx.arc(x, normalizedY, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }, [dailyValues, moodRatings]);
    return h(
      WidgetWrapper,
      {
        title: "Victory Value",
        icon: "\\u{1F3C6}",
        widgetId: "victory-value",
        configurable: true
      },
      h(
        "div",
        { className: "vv-header" },
        h("span", { className: "vv-total" }, weeklyTotal),
        h("span", { className: "vv-label" }, "points this week")
      ),
      h("canvas", { ref: canvasRef, className: "vv-chart", style: { width: "100%", height: "180px" } })
    );
  }

  // lib/dashboard/mood.js
  function MoodWidget({ moodRatings }) {
    const h = react_default.createElement;
    const MOODS = [
      { value: -2, emoji: "\\u{1F622}", label: "Awful" },
      { value: -1, emoji: "\\u{1F61F}", label: "Bad" },
      { value: 0, emoji: "\\u{1F610}", label: "Okay" },
      { value: 1, emoji: "\\u{1F642}", label: "Good" },
      { value: 2, emoji: "\\u{1F604}", label: "Great" }
    ];
    const recentMoods = (moodRatings || []).slice(-7);
    const avgMood = recentMoods.length ? (recentMoods.reduce((s, m) => s + m.rating, 0) / recentMoods.length).toFixed(1) : "\\u2014";
    return h(
      WidgetWrapper,
      { title: "How are you feeling?", icon: "\\u{1F3AD}", widgetId: "mood" },
      h(
        "div",
        { className: "mood-selector" },
        MOODS.map((m) => h("button", {
          key: m.value,
          className: "mood-btn",
          title: m.label
        }, h("span", { className: "mood-emoji" }, m.emoji)))
      ),
      h(
        "div",
        { className: "mood-summary" },
        h("span", null, "Avg mood (7d): " + avgMood),
        h(
          "div",
          { className: "mood-sparkline" },
          recentMoods.map((m, i) => h("div", {
            key: i,
            className: "mood-dot",
            style: { bottom: (m.rating + 2) / 4 * 100 + "%" }
          }))
        )
      )
    );
  }

  // lib/dashboard/calendar.js
  function CalendarWidget({ tasks, currentDate, settings }) {
    const h = createElement;
    const today = new Date(currentDate);
    const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
    const weekStartsOn = settings?.["dashboard_calendar_config"]?.[0] === "1" ? 1 : 0;
    const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
    const firstDayOfWeek = (new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay() - weekStartsOn + 7) % 7;
    const DAY_LABELS = weekStartsOn === 1 ? ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    const taskCountByDay = {};
    (tasks || []).forEach((t) => {
      if (t.startAt) {
        const d = new Date(t.startAt);
        if (d.getMonth() === viewDate.getMonth() && d.getFullYear() === viewDate.getFullYear()) {
          const day = d.getDate();
          taskCountByDay[day] = (taskCountByDay[day] || 0) + 1;
        }
      }
    });
    const prevMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
    const nextMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
    const monthName = viewDate.toLocaleString("default", { month: "long", year: "numeric" });
    const isToday = (day) => day === today.getDate() && viewDate.getMonth() === today.getMonth() && viewDate.getFullYear() === today.getFullYear();
    const cells = [];
    for (let i = 0; i < firstDayOfWeek; i++)
      cells.push(h("div", { key: "empty-" + i, className: "cal-cell empty" }));
    for (let day = 1; day <= daysInMonth; day++) {
      const count = taskCountByDay[day] || 0;
      const dotColor = count === 0 ? "none" : count <= 2 ? "#86efac" : count <= 5 ? "#fbbf24" : "#f87171";
      cells.push(h(
        "div",
        {
          key: day,
          className: "cal-cell" + (isToday(day) ? " today" : "")
        },
        h("span", { className: "cal-day" }, day),
        dotColor !== "none" ? h("span", { className: "cal-dot", style: { backgroundColor: dotColor } }) : null
      ));
    }
    return h(
      WidgetWrapper,
      { title: "Calendar", icon: "\\u{1F4C5}", widgetId: "calendar", configurable: true },
      h(
        "div",
        { className: "cal-nav" },
        h("button", { onClick: prevMonth, className: "cal-arrow" }, "\\u25C0"),
        h("span", { className: "cal-month" }, monthName),
        h("button", { onClick: nextMonth, className: "cal-arrow" }, "\\u25B6")
      ),
      h(
        "div",
        { className: "cal-grid" },
        DAY_LABELS.map((d) => h("div", { key: d, className: "cal-header" }, d)),
        ...cells
      )
    );
  }

  // lib/dashboard/agenda.js
  function AgendaWidget({ todayTasks }) {
    const h = createElement;
    const priorityColor = (task) => {
      if (task.important && task.urgent)
        return "#ef4444";
      if (task.important)
        return "#f59e0b";
      if (task.urgent)
        return "#3b82f6";
      return "#6b7280";
    };
    const formatTime = (timestamp) => {
      if (!timestamp)
        return "";
      return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    };
    return h(
      WidgetWrapper,
      { title: "Today's Agenda", icon: "\\u{1F4CB}", widgetId: "agenda" },
      todayTasks.length === 0 ? h("div", { className: "agenda-empty" }, "No scheduled tasks today \\u2728") : h(
        "div",
        { className: "agenda-list" },
        todayTasks.map((task) => h(
          "div",
          { key: task.uuid, className: "agenda-item" },
          h("div", { className: "agenda-indicator", style: { backgroundColor: priorityColor(task) } }),
          h(
            "div",
            { className: "agenda-content" },
            h("span", { className: "agenda-time" }, formatTime(task.startAt)),
            h("span", { className: "agenda-text" }, task.content?.replace(/[\\\\[\\\\]#*_\`]/g, "") || "Untitled task")
          ),
          task.endAt ? h(
            "span",
            { className: "agenda-duration" },
            Math.round((task.endAt - task.startAt) / 6e4) + "m"
          ) : null
        ))
      )
    );
  }

  // lib/dashboard/quotes.js
  function QuotesWidget({ quotes, planContent }) {
    const h = createElement;
    const [displayQuotes, setDisplayQuotes] = useState(quotes || []);
    const [loading, setLoading] = useState(!quotes);
    const BG_IMAGES = [
      "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=300&fit=crop",
      "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=600&h=300&fit=crop"
    ];
    useEffect(() => {
      if (!quotes) {
        setLoading(true);
        callPlugin("fetchQuotes", planContent).then((q) => {
          setDisplayQuotes(q || []);
          setLoading(false);
        });
      }
    }, []);
    if (loading)
      return h(
        WidgetWrapper,
        { title: "Inspiration", icon: "\\u{1F4A1}", widgetId: "quotes" },
        h("div", { className: "quotes-loading" }, "Generating quotes...")
      );
    return h(
      WidgetWrapper,
      { title: "Inspiration", icon: "\\u{1F4A1}", widgetId: "quotes", configurable: true },
      h(
        "div",
        { className: "quotes-grid" },
        displayQuotes.slice(0, 2).map(
          (q, i) => h(
            "div",
            {
              key: i,
              className: "quote-tile",
              style: { backgroundImage: "linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.6)), url(" + BG_IMAGES[i % BG_IMAGES.length] + ")" }
            },
            h("p", { className: "quote-text" }, '"' + q.text + '"'),
            q.author ? h("span", { className: "quote-author" }, "\\u2014 " + q.author) : null
          )
        )
      )
    );
  }

  // lib/dashboard/ai-plugins.js
  function AIPluginsWidget({ taskCount, flashcardsDue }) {
    const h = createElement;
    const items = [
      { label: "Propose Task Values", badge: taskCount || 0, icon: "\\u{1F3AF}" },
      { label: "Flashcard Review", badge: flashcardsDue || 0, icon: "\\u{1F0CF}" }
    ];
    return h(
      WidgetWrapper,
      { title: "AI & Plugins", icon: "\\u{1F916}", widgetId: "ai-plugins" },
      h(
        "div",
        { className: "aip-list" },
        items.map((item) => h(
          "div",
          { key: item.label, className: "aip-item" },
          h("span", { className: "aip-icon" }, item.icon),
          h("span", { className: "aip-label" }, item.label),
          item.badge > 0 ? h("span", { className: "aip-badge" }, item.badge) : null
        ))
      )
    );
  }

  // lib/dashboard/quick-actions.js
  function QuickActionsWidget() {
    const h = createElement;
    const actions = [
      { label: "Daily Jot", icon: "\\u{1F4DD}", action: "dailyJot" },
      { label: "Journal", icon: "\\u{1F4D3}", action: "journal" },
      { label: "Add Person", icon: "\\u{1F464}", action: "addPerson" },
      { label: "Browse CRM", icon: "\\u{1F4C7}", action: "browseCRM" }
    ];
    const handleAction = async (action) => {
      await callPlugin("quickAction", action);
    };
    return h(
      WidgetWrapper,
      { title: "Quick Actions", icon: "\\u26A1", widgetId: "quick-actions" },
      h(
        "div",
        { className: "qa-grid" },
        actions.map((a) => h(
          "button",
          {
            key: a.action,
            className: "qa-button",
            onClick: () => handleAction(a.action)
          },
          h("span", { className: "qa-icon" }, a.icon),
          h("span", { className: "qa-label" }, a.label)
        ))
      )
    );
  }

  // lib/dashboard/app.js
  function DashboardApp() {
    const h = createElement;
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
      callPlugin("init").then((result) => {
        if (result?.error)
          setError(result.error);
        else
          setData(result);
      }).catch((err) => setError(err.message));
    }, []);
    if (error)
      return h(
        "div",
        { className: "dashboard-error" },
        h("h2", null, "Dashboard Error"),
        h("p", null, error)
      );
    if (!data)
      return h(
        "div",
        { className: "dashboard-loading" },
        h("div", { className: "spinner" }),
        h("p", null, "Loading dashboard...")
      );
    return h(
      "div",
      { className: "dashboard" },
      h(
        "div",
        { className: "dashboard-grid" },
        h(
          "div",
          { className: "grid-cell span-2" },
          h(PlanningWidget, { quarterlyPlans: data.quarterlyPlans })
        ),
        h(
          "div",
          { className: "grid-cell span-2" },
          h(VictoryValueWidget, {
            dailyValues: data.dailyVictoryValues,
            weeklyTotal: data.weeklyVictoryValue,
            moodRatings: data.moodRatings,
            settings: data.settings
          })
        ),
        h(
          "div",
          { className: "grid-cell" },
          h(MoodWidget, { moodRatings: data.moodRatings })
        ),
        h(
          "div",
          { className: "grid-cell" },
          h(CalendarWidget, {
            tasks: data.tasks,
            currentDate: data.currentDate,
            settings: data.settings
          })
        ),
        h(
          "div",
          { className: "grid-cell" },
          h(AgendaWidget, { todayTasks: data.todayTasks })
        ),
        h(
          "div",
          { className: "grid-cell span-2" },
          h(QuotesWidget, {
            quotes: null,
            planContent: data.quarterlyPlans?.current?.noteUUID ? null : null
          })
        ),
        h(
          "div",
          { className: "grid-cell" },
          h(AIPluginsWidget, { taskCount: 0, flashcardsDue: 0 })
        ),
        h(
          "div",
          { className: "grid-cell" },
          h(QuickActionsWidget, {})
        )
      )
    );
  }

  // lib/dashboard/client-entry.js
  var root = react_dom_default.createRoot(document.getElementById("dashboard-root"));
  root.render(createElement(DashboardApp));
})();
`;

  // lib/embed-html.js
  function buildEmbedHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* Styles will be added later */
  </style>
</head>
<body>
  <div id="dashboard-root"></div>

  <script src="https://esm.sh/react@18?bundle"></script>
  <script src="https://esm.sh/react-dom@18?bundle"></script>
  <script>
    // Bridge helper
    const callPlugin = (action, ...args) => window.callAmplenotePlugin(action, ...args);

    ${clientBundle}
  </script>
</body>
</html>`;
  }

  // lib/constants/quarters.js
  function getCurrentQuarter() {
    const now = /* @__PURE__ */ new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const quarter = Math.floor(month / 3) + 1;
    return {
      year,
      quarter,
      label: `Q${quarter} ${year}`
    };
  }
  function getNextQuarter() {
    const current = getCurrentQuarter();
    let { year, quarter } = current;
    quarter++;
    if (quarter > 4) {
      quarter = 1;
      year++;
    }
    return {
      year,
      quarter,
      label: `Q${quarter} ${year}`
    };
  }

  // lib/data-service.js
  async function fetchDashboardData(app) {
    const now = /* @__PURE__ */ new Date();
    const weekStart = _getWeekStart(now);
    const weekEnd = _getWeekEnd(now);
    const [domains, moodRatings, quarterlyPlans, settings] = await Promise.all([
      app.getTaskDomains(),
      _safeMoodRatings(app, weekStart.getTime(), weekEnd.getTime()),
      _findQuarterlyPlans(app),
      _readDashboardSettings(app)
    ]);
    const tasksByDomain = await Promise.all(
      domains.map(async (domain) => ({
        domain: domain.name,
        tasks: await app.getTaskDomainTasks(domain.handle || domain)
      }))
    );
    const allTasks = tasksByDomain.flatMap((d) => d.tasks);
    return {
      tasks: allTasks,
      todayTasks: _filterTodayTasks(allTasks, now),
      completedThisWeek: _filterCompletedInRange(allTasks, weekStart, weekEnd),
      weeklyVictoryValue: _calculateWeeklyVictoryValue(allTasks, weekStart, weekEnd),
      dailyVictoryValues: _calculateDailyVictoryValues(allTasks, weekStart),
      moodRatings,
      quarterlyPlans,
      currentDate: now.toISOString(),
      settings
    };
  }
  async function createQuarterlyPlan(app, quarterInfo) {
    const { label, year, quarter } = quarterInfo;
    const noteName = `${label} Plan`;
    const tags = ["planning/quarterly"];
    const existing = await app.filterNotes({ query: noteName });
    const match = existing.find((n) => n.name === noteName);
    if (match) {
      await app.navigate(`https://www.amplenote.com/notes/${match.uuid}`);
      return { uuid: match.uuid, existed: true };
    }
    const prevLabel = _previousQuarterLabel(year, quarter);
    const prevNotes = await app.filterNotes({ query: `${prevLabel} Plan` });
    let template = _defaultQuarterlyTemplate(label);
    if (prevNotes.length > 0) {
      const prevContent = await app.getNoteContent({ uuid: prevNotes[0].uuid });
      const headings = _extractHeadings(prevContent);
      if (headings.length > 0) {
        template = `# ${label} Plan

` + headings.map((h) => `${h}

`).join("");
      }
    }
    const uuid = await app.createNote(noteName, tags);
    await app.insertNoteContent({ uuid }, template);
    await app.navigate(`https://www.amplenote.com/notes/${uuid}`);
    return { uuid, existed: false };
  }
  async function fetchQuotes(app, planContent) {
    const apiKey = app.settings["LLM API Key"];
    const provider = app.settings["LLM Provider"] || "openai";
    if (!apiKey) {
      return [
        { text: "Set an LLM API key in plugin settings to generate personalized quotes.", author: "" },
        { text: "The journey of a thousand miles begins with a single step.", author: "Lao Tzu" }
      ];
    }
    const prompt = planContent ? `Based on these quarterly goals, generate 2 short inspirational quotes (1-2 sentences each) that motivate progress toward these goals. Return as JSON array [{text, author}]. Goals: ${planContent.substring(0, 500)}` : `Generate 2 short inspirational quotes about productivity and personal growth. Return as JSON array [{text, author}].`;
    const endpoint = provider === "anthropic" ? "https://api.anthropic.com/v1/messages" : "https://api.openai.com/v1/chat/completions";
    const headers = provider === "anthropic" ? { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" } : { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` };
    const body = provider === "anthropic" ? { model: "claude-sonnet-4-20250514", max_tokens: 300, messages: [{ role: "user", content: prompt }] } : { model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 300 };
    try {
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
      const json = await response.json();
      const text = provider === "anthropic" ? json?.content?.[0]?.text : json?.choices?.[0]?.message?.content;
      return JSON.parse(text);
    } catch (error) {
      console.error("Quote fetch error:", error);
      return [
        { text: "What gets measured gets managed.", author: "Peter Drucker" },
        { text: "Small daily improvements lead to stunning results.", author: "Robin Sharma" }
      ];
    }
  }
  async function navigateToNote(app, noteUUID) {
    await app.navigate(`https://www.amplenote.com/notes/${noteUUID}`);
  }
  function _filterTodayTasks(tasks, now) {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayEnd = dayStart + 864e5;
    return tasks.filter(
      (t) => !t.completedAt && !t.dismissedAt && t.startAt && t.startAt >= dayStart && t.startAt < dayEnd
    ).sort((a, b) => a.startAt - b.startAt);
  }
  function _filterCompletedInRange(tasks, start, end) {
    return tasks.filter(
      (t) => t.completedAt && t.completedAt >= start.getTime() && t.completedAt <= end.getTime()
    );
  }
  function _calculateWeeklyVictoryValue(tasks, weekStart, weekEnd) {
    return _filterCompletedInRange(tasks, weekStart, weekEnd).reduce((sum, t) => sum + (t.victoryValue || 0), 0);
  }
  function _calculateDailyVictoryValues(tasks, weekStart) {
    const days = Array.from({ length: 7 }, (_, i) => {
      const dayStart = new Date(weekStart);
      dayStart.setDate(dayStart.getDate() + i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const dayTasks = tasks.filter(
        (t) => t.completedAt && t.completedAt >= dayStart.getTime() && t.completedAt < dayEnd.getTime()
      );
      return {
        day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
        date: dayStart.toISOString(),
        value: dayTasks.reduce((sum, t) => sum + (t.victoryValue || 0), 0),
        taskCount: dayTasks.length
      };
    });
    return days;
  }
  async function _safeMoodRatings(app, startTimestamp, endTimestamp) {
    try {
      return await app.getMoodRatings(startTimestamp, endTimestamp);
    } catch (e) {
      console.error("getMoodRatings not available or failed:", e);
      return [];
    }
  }
  async function _findQuarterlyPlans(app) {
    const current = getCurrentQuarter();
    const next = getNextQuarter();
    const [currentPlans, nextPlans] = await Promise.all([
      app.filterNotes({ query: `${current.label} Plan` }),
      app.filterNotes({ query: `${next.label} Plan` })
    ]);
    return {
      current: { ...current, noteUUID: currentPlans.find((n) => n.name === `${current.label} Plan`)?.uuid },
      next: { ...next, noteUUID: nextPlans.find((n) => n.name === `${next.label} Plan`)?.uuid }
    };
  }
  async function _readDashboardSettings(app) {
    const keys = ["dashboard_victory-value_config", "dashboard_calendar_config", "dashboard_quotes_config"];
    const settings = {};
    for (const key of keys) {
      try {
        const val = app.settings[key];
        settings[key] = val ? JSON.parse(val) : null;
      } catch {
        settings[key] = null;
      }
    }
    return settings;
  }
  function _getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function _getWeekEnd(date) {
    const start = _getWeekStart(date);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return end;
  }
  function _previousQuarterLabel(year, quarter) {
    if (quarter === 1)
      return `Q4 ${year - 1}`;
    return `Q${quarter - 1} ${year}`;
  }
  function _extractHeadings(markdownContent) {
    return (markdownContent.match(/^#{1,3}\s+.+$/gm) || []).filter((h) => !h.startsWith("# "));
  }
  function _defaultQuarterlyTemplate(label) {
    return `# ${label} Plan

## Goals

## Key Results

## Projects

## Reflections

`;
  }

  // lib/plugin.js
  var plugin = {
    // --------------------------------------------------------------------------------------
    // Constants
    // --------------------------------------------------------------------------------------
    constants: {},
    // --------------------------------------------------------------------------------------
    // App Options — Quick Open menu entries
    // --------------------------------------------------------------------------------------
    appOption: {
      "Open Dashboard": async function(app) {
        await app.openSidebarEmbed(1.5);
      },
      "Open Dashboard (Full)": async function(app) {
        await app.openEmbed();
      }
    },
    // --------------------------------------------------------------------------------------
    // Embed Rendering
    // --------------------------------------------------------------------------------------
    async renderEmbed(app) {
      try {
        return buildEmbedHTML();
      } catch (error) {
        console.error("Dashboard renderEmbed error:", error);
        return `<div style="padding:20px;color:red;">Dashboard failed to load: ${error.message}</div>`;
      }
    },
    // --------------------------------------------------------------------------------------
    // Embed Communication Bridge
    // --------------------------------------------------------------------------------------
    async onEmbedCall(app, actionType, ...args) {
      try {
        switch (actionType) {
          case "init":
            return await fetchDashboardData(app);
          case "getTaskDomainTasks":
            return await app.getTaskDomainTasks(args[0]);
          case "getMoodRatings":
            return await app.getMoodRatings(args[0], args[1]);
          case "filterNotes":
            return await app.filterNotes(args[0]);
          case "createQuarterlyPlan":
            return await createQuarterlyPlan(app, args[0]);
          case "navigateToNote":
            return await navigateToNote(app, args[0]);
          case "configure":
            return await this._handleConfigure(app, args[0]);
          case "fetchQuotes":
            return await fetchQuotes(app, args[0]);
          case "getNoteContent":
            return await app.getNoteContent({ uuid: args[0] });
          default:
            console.error(`Unknown embed action: ${actionType}`);
            return null;
        }
      } catch (error) {
        console.error(`onEmbedCall error (${actionType}):`, error);
        return { error: error.message };
      }
    },
    // --------------------------------------------------------------------------------------
    // Private Methods
    // --------------------------------------------------------------------------------------
    async _handleConfigure(app, widgetId) {
      const configs = {
        "victory-value": {
          title: "Configure Victory Value",
          inputs: [
            { label: "Time range", type: "radio", options: [
              { label: "This week", value: "week" },
              { label: "This month", value: "month" },
              { label: "Last 30 days", value: "30days" }
            ] },
            { label: "Show mood overlay", type: "checkbox", value: true }
          ]
        },
        "calendar": {
          title: "Configure Calendar",
          inputs: [
            { label: "Week starts on", type: "radio", options: [
              { label: "Sunday", value: "0" },
              { label: "Monday", value: "1" }
            ] }
          ]
        },
        "quotes": {
          title: "Configure Quotes",
          inputs: [
            { label: "Quote style", type: "radio", options: [
              { label: "Motivational", value: "motivational" },
              { label: "Philosophical", value: "philosophical" },
              { label: "From quarterly goals", value: "goals" }
            ] }
          ]
        }
      };
      const config = configs[widgetId];
      if (!config)
        return null;
      const result = await app.prompt(config.title, { inputs: config.inputs });
      if (!result)
        return null;
      await app.setSetting(`dashboard_${widgetId}_config`, JSON.stringify(
        Array.isArray(result) ? result : [result]
      ));
      return result;
    }
  };
  var plugin_default = plugin;
})();
