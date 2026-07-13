/**
 * [Claude-authored file]
 * Created: 2026-07-13 | Model: claude-opus-4-8 (1M context)
 * Task: Normalize app.filterNotes results that arrive as async-iterable-mimicking objects
 * Prompt summary: "filterNotes result in certain client environments is an object mimicking
 *   an async iterable, not an array, so .find is undefined and raises an exception"
 */

// --------------------------------------------------------------------------------------
// @desc Normalize an app.filterNotes call into a plain array. Pass the filterNotes call
//   itself (its return value) — this helper awaits it internally, which is deliberate:
//   the Amplenote app bridge returns a NON-spec-compliant thenable whose explicit
//   `.then(cb)` resolves to `undefined` (dropping cb's return), so callers must never
//   write `app.filterNotes(...).then(normalize)` — that yields `undefined` and any later
//   `.find`/`.filter` throws "Cannot read properties of undefined". An engine-level
//   `await` (used here and by Promise.all) extracts the real value correctly, so awaiting
//   inside this helper is the safe, footgun-proof entry point.
//   Once resolved: in most environments filterNotes yields an array (passed straight
//   through), but some hosts return an object implementing only the async-iterable protocol
//   (a [Symbol.asyncIterator]() whose next() lazily pulls note batches) — we drain that
//   fully into an array. null/undefined and other non-iterable values collapse to [] so
//   callers can always use array methods.
// @param {Promise|Array|AsyncIterable|Object|null} result - The value returned by
//   app.filterNotes(...) (a bridge thenable), or an already-resolved value.
// @returns {Promise<Array>} The matched notes as a plain array
// [Claude claude-opus-4-8 (1M context)] Task: await internally to survive the bridge's
//   non-spec-compliant thenable, then normalize array / async-iterable / empty shapes
// Prompt: "the .then() chaining broke on web — Cannot read properties of undefined (find)"
export async function arrayFromFilterNotesResult(result) {
  const resolved = await result;
  if (Array.isArray(resolved)) return resolved;
  if (resolved && typeof(resolved[Symbol.asyncIterator]) === "function") {
    const notes = [];
    for await (const note of resolved) notes.push(note);
    return notes;
  }
  return [];
}
