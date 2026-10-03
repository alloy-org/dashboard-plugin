// Send a running job's generative and Jev requests through the Dashboard's resource budget. Every request, including
// each one of a nested batch, waits for its own permit and returns it the moment the request ends, so a job never
// holds a provider permit while waiting on anything else and a batch can never exceed the provider's limit.
// Foreground requests are served before waiting maintenance; with one generative permit, maintenance requests run
// one at a time.

// Resources a provider request may name.
const PROVIDER_RESOURCES = ["generative", "jev"];

// ----------------------------------------------------------------------------------------------
// @desc Create a provider dispatcher over a budget.
// @param {object} options - { budget }: a DashboardResourceBudget.
// @returns {object} An object with the following properties:
//   - {function} generative - (operation, options) => the result of one generative request
//   - {function} jev - (operation, options) => the result of one Jev request
//   - {function} runEach - (resource, items, operation, options) => results of operation(item, index) for every item,
//     each request taking its own permit, in item order
//   Options are { background = true, signal = null }: background false marks a request the user is waiting on, and
//   an aborted signal gives up a request still waiting for its permit. operation receives { signal }.
export function createProviderDispatch({ budget }) {
  const run = async (resource, operation, { background = true, signal = null } = {}) => {
    if (!PROVIDER_RESOURCES.includes(resource)) throw new Error(`"${ resource }" is not a provider resource`);
    const permit = await budget.acquire(resource, { background, signal });
    try {
      return await operation({ signal });
    } finally {
      permit.release();
    }
  };
  const runEach = (resource, items, operation, options) => {
    const requests = items.map((item, index) => run(resource, () => operation(item, index), options));
    return Promise.all(requests);
  };
  return { generative: (operation, options) => run("generative", operation, options),
    jev: (operation, options) => run("jev", operation, options), runEach };
}
