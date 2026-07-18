/**
 * [Claude claude-opus-4-8 (1M context)-authored file]
 * Prompt summary: "end-to-end test of the Energy Per Habit service against the REAL Node dev app — its year-long
 *   habit + mood fixture and real note-file create/read/section-replace — so we exercise the whole cache flow
 *   (discover many habits, create the cache note with per-month 4-column tables, refresh the current month in place)"
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createDevApp } from "../dev/dev-app.js";
import { loadEnergyPerHabit } from "energy-per-habit-service";
import { HABIT_CACHE_NOTE_NAME } from "energy-per-habit-cache";
import { monthLabelFromMonthKey, monthKeyFromDate } from "energy-per-habit-analysis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function cacheNoteContent(notesDir) {
  for (const file of fs.readdirSync(notesDir)) {
    const raw = fs.readFileSync(path.join(notesDir, file), "utf-8");
    if (raw.includes(`# ${HABIT_CACHE_NOTE_NAME}`)) return raw;
  }
  return null;
}

describe("Energy Per Habit end-to-end against the dev app", () => {
  let tmp, app;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "energy-per-habit-e2e-"));
    fs.mkdirSync(path.join(tmp, "notes"));
    app = createDevApp(path.join(tmp, "settings.json"), path.join(tmp, "notes"), path.join(tmp, "moods.json"));
  });

  afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  test("first load discovers many habits and writes a per-month cache note", async () => {
    const result = await loadEnergyPerHabit(app);
    // The dev fixture defines 8 recurring habits over a year; most clear the 5-completion / 3-mood-day gate.
    expect(result.habits.length).toBeGreaterThanOrEqual(5);
    expect(result.cached).toBe(false);

    const note = cacheNoteContent(path.join(tmp, "notes"));
    expect(note).not.toBeNull();
    // Current month section + the prescribed table header (now including the weeks-streak column).
    expect(note).toContain(`## ${monthLabelFromMonthKey(monthKeyFromDate(new Date()))}`);
    expect(note).toContain("| Task | Completions | Weeks streak | Mood on done days | Mood on off days |");
    // Multiple month sections across the trailing year.
    const monthSections = (note.match(/^##\s+\w+\s+\d{4}\s*$/gm) || []).length;
    expect(monthSections).toBeGreaterThanOrEqual(6);
  });

  test("second load reuses the cache (current month recomputes identically -> no rewrite)", async () => {
    const result = await loadEnergyPerHabit(app);
    expect(result.habits.length).toBeGreaterThanOrEqual(5);
    expect(result.cached).toBe(true);
  });

  test("habits carry a mood delta and completion count", async () => {
    const result = await loadEnergyPerHabit(app);
    const top = result.habits[0];
    expect(typeof top.delta).toBe("number");
    expect(top.completions).toBeGreaterThanOrEqual(5);
    expect(top.doneWithMood).toBeGreaterThanOrEqual(3);
  });
});
