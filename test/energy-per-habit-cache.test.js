/**
 * [Claude claude-opus-4-8 (1M context)-authored file]
 * Prompt summary: "test the energy-per-habit cache note: month-table serialize/parse round-trip, mood-array cells,
 *   pipe escaping, and the load/persist flow (create note, in-place current-month section replace, full rewrite)"
 */
import {
  HABIT_CACHE_NOTE_NAME, loadHabitCache, monthsFromNoteContent, monthTableMarkdown, persistHabitCache,
} from "energy-per-habit-cache";

// Minimal in-memory app double backing findNote/getNoteContent/createNote/replaceNoteContent.
function makeApp({ notes = {} } = {}) {
  const store = { ...notes };
  const calls = { replace: [] };
  return {
    calls,
    store,
    async findNote({ name }) {
      const uuid = Object.keys(store).find(id => store[id].name === name);
      return uuid ? { uuid, name } : null;
    },
    async getNoteContent({ uuid }) {
      return store[uuid]?.content ?? "";
    },
    async createNote(name) {
      const uuid = `uuid-${Object.keys(store).length + 1}`;
      store[uuid] = { name, content: "" };
      return uuid;
    },
    async replaceNoteContent(handle, content, options = {}) {
      const uuid = handle.uuid;
      calls.replace.push({ uuid, content, options });
      if (options?.section?.heading?.text) {
        const heading = options.section.heading.text;
        const re = new RegExp(`(^##\\s+${heading}\\s*$\\n)([\\s\\S]*?)(?=^##\\s+|$(?![\\s\\S]))`, "m");
        store[uuid].content = store[uuid].content.replace(re, (_m, head) => `${head}${content.trim()}\n`);
      } else {
        store[uuid].content = content;
      }
      return true;
    },
  };
}

const ROWS = [
  { label: "Morning exercise", count: 12, doneMoods: [1, 2, 0.5], offMoods: [-1, 0] },
  { label: "Pipe | in name", count: 3, doneMoods: [1], offMoods: [2, -2] },
];

describe("monthTableMarkdown + monthsFromNoteContent", () => {
  test("round-trips rows through a rendered note section", () => {
    const note = `# ${HABIT_CACHE_NOTE_NAME}\n\n## May 2026\n\n${monthTableMarkdown(ROWS)}\n`;
    const months = monthsFromNoteContent(note);
    const rows = months.get("2026-05").rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].label).toBe("Morning exercise");
    expect(rows[0].count).toBe(12);
    expect(rows[0].doneMoods).toEqual([1, 2, 0.5]);
    expect(rows[0].offMoods).toEqual([-1, 0]);
    expect(rows[1].label).toBe("Pipe | in name"); // pipe survives escape/unescape
  });

  test("parses multiple month sections keyed by YYYY-MM", () => {
    const note = `# x\n\n## July 2026\n\n${monthTableMarkdown([ROWS[0]])}\n\n## June 2026\n\n${monthTableMarkdown([ROWS[1]])}\n`;
    const months = monthsFromNoteContent(note);
    expect([...months.keys()].sort()).toEqual(["2026-06", "2026-07"]);
  });
});

describe("loadHabitCache", () => {
  test("returns empty map and null handle when the note does not exist", async () => {
    const app = makeApp();
    const cache = await loadHabitCache(app);
    expect(cache.noteHandle).toBeNull();
    expect(cache.monthsByKey.size).toBe(0);
  });

  test("loads and parses an existing cache note", async () => {
    const content = `# ${HABIT_CACHE_NOTE_NAME}\n\n## May 2026\n\n${monthTableMarkdown(ROWS)}\n`;
    const app = makeApp({ notes: { "n1": { name: HABIT_CACHE_NOTE_NAME, content } } });
    const cache = await loadHabitCache(app);
    expect(cache.noteHandle.uuid).toBe("n1");
    expect(cache.monthsByKey.get("2026-05").rows).toHaveLength(2);
  });
});

describe("persistHabitCache", () => {
  test("creates the note and writes the full month map when none exists", async () => {
    const app = makeApp();
    const monthsByKey = new Map([["2026-07", { monthKey: "2026-07", rows: [ROWS[0]] }]]);
    await persistHabitCache(app, { noteHandle: null, rawContent: "", monthsByKey,
      currentMonthKey: "2026-07", changedMonthKeys: ["2026-07"] });
    const written = Object.values(app.store)[0].content;
    expect(written).toContain("## July 2026");
    expect(written).toContain("Morning exercise");
  });

  test("replaces only the current-month section in place when it already exists", async () => {
    const existing = `# ${HABIT_CACHE_NOTE_NAME}\n\n## July 2026\n\n${monthTableMarkdown([ROWS[1]])}\n\n## June 2026\n\n${monthTableMarkdown([ROWS[1]])}\n`;
    const app = makeApp({ notes: { "n1": { name: HABIT_CACHE_NOTE_NAME, content: existing } } });
    const monthsByKey = monthsFromNoteContent(existing);
    monthsByKey.set("2026-07", { monthKey: "2026-07", rows: [ROWS[0]] }); // change July
    await persistHabitCache(app, { noteHandle: { uuid: "n1" }, rawContent: existing, monthsByKey,
      currentMonthKey: "2026-07", changedMonthKeys: ["2026-07"] });
    expect(app.calls.replace).toHaveLength(1);
    expect(app.calls.replace[0].options.section.heading.text).toBe("July 2026");
    expect(app.store.n1.content).toContain("Morning exercise"); // July updated
    expect(monthsFromNoteContent(app.store.n1.content).get("2026-06").rows).toHaveLength(1); // June untouched
  });
});
