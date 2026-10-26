// Run asynchronous work over a list with a cap on how much runs at once, so a long list of host or network calls
// neither runs one at a time nor floods the host with every call together.

// ----------------------------------------------------------------------------------------------
// @desc Run a task for each item, at most `limit` at a time.
// @param {Array<*>} items - Items to work through.
// @param {number} limit - Most tasks running at once.
// @param {Function} task - Receives one item and its index; its promise settles before another item starts in its place.
// @returns {Promise<void>} Resolves once every item's task has settled.
export async function forEachWithConcurrency(items, limit, task) {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await task(items[index], index);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
}
