// [Claude claude-opus-4-8 (1M context)] Generated tests for: arrayFromFilterNotesResult — normalize
//   the several shapes app.filterNotes resolves to (array, async-iterable object, empty), and survive
//   the Amplenote bridge's non-spec-compliant thenable that broke the earlier `.then()`-chained fix.
import { arrayFromFilterNotesResult } from "util/note-handles";

// ----------------------------------------------------------------------------------------------
// @desc Build an object mimicking the async-iterable shape some clients return from filterNotes:
//   NOT a real array (no .find), only a [Symbol.asyncIterator]() whose next() yields a fixed batch.
// @param {Array<Object>} notes - Notes the fake iterable should yield across its batch.
// [Claude claude-opus-4-8 (1M context)] Task: fixture for the async-iterable-mimicking filterNotes result
function asyncIterableOf(notes) {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return { async next() {
        return index < notes.length ? { done: false, value: notes[index++] } : { done: true };
      } };
    }
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Build a NON-spec-compliant thenable like the Amplenote app bridge: awaiting it (engine-level)
//   resolves to `value`, but an explicit `.then(cb)` returns undefined and drops cb's return — the
//   exact footgun that made `filterNotes(...).then(normalize)` resolve to undefined and crash on .find.
// @param {*} value - The value the bridge ultimately resolves to when awaited.
// [Claude claude-opus-4-8 (1M context)] Task: reproduce the bridge thenable that broke .then()-chaining
function nonCompliantBridgeThenable(value) {
  return {
    then(onFulfilled) {
      // Engine-level await calls then(resolve, reject) and uses resolve(value) — so await works.
      // But the RETURN value of an explicit .then(cb) is undefined here, dropping cb's result.
      if (typeof onFulfilled === "function") onFulfilled(value);
      return undefined;
    }
  };
}

describe("arrayFromFilterNotesResult", () => {
  it("passes a plain array straight through", async () => {
    const notes = [{ name: "Q3 2026 Plan" }, { name: "Other" }];
    expect(await arrayFromFilterNotesResult(notes)).toBe(notes);
  });

  it("drains an async-iterable-mimicking object into an array", async () => {
    const notes = [{ name: "Q3 2026 Plan" }, { name: "Q4 2026 Plan" }];
    const result = await arrayFromFilterNotesResult(asyncIterableOf(notes));
    expect(result).toEqual(notes);
    expect(result.find(n => n.name === "Q4 2026 Plan")).toBeDefined();
  });

  it("collapses undefined/null to an empty array", async () => {
    expect(await arrayFromFilterNotesResult(undefined)).toEqual([]);
    expect(await arrayFromFilterNotesResult(null)).toEqual([]);
  });

  it("awaits a Promise resolving to an array", async () => {
    const notes = [{ name: "Q3 2026 Plan" }];
    expect(await arrayFromFilterNotesResult(Promise.resolve(notes))).toEqual(notes);
  });

  it("resolves the bridge's non-compliant thenable to the real array (the regression)", async () => {
    const notes = [{ name: "Q3 2026 Plan" }];
    const result = await arrayFromFilterNotesResult(nonCompliantBridgeThenable(notes));
    expect(result).toEqual(notes);
    // Guard: a `.then()`-chained normalize would have yielded undefined here.
    expect(result.find(n => n.name === "Q3 2026 Plan")).toBeDefined();
  });

  it("drains a bridge thenable that resolves to an async-iterable object", async () => {
    const notes = [{ name: "Q4 2026 Plan" }];
    const result = await arrayFromFilterNotesResult(nonCompliantBridgeThenable(asyncIterableOf(notes)));
    expect(result).toEqual(notes);
  });
});
