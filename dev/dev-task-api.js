// Bridge the browser development app's note-task operations to its file-backed app implementation.
const TASK_ACTIONS = new Set(["addTaskDomainNote", "getNoteTasks", "insertTask"]);

// ----------------------------------------------------------------------------------------------
// @desc Dispatch supported note-task operations and report failures without pretending a write succeeded.
// @param {object} app - File-backed development app.
// @param {object} req - HTTP request containing an action and its positional arguments.
// @param {object} res - HTTP response.
// @returns {boolean} Whether this handler accepts the request method.
export function handleTaskApi(app, req, res) {
  if (req.method !== "POST") return false;
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", async () => {
    try {
      const { action, args } = JSON.parse(body);
      if (!TASK_ACTIONS.has(action) || !Array.isArray(args)) throw new Error("Unsupported task operation");
      const result = await app[action](...args);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result }));
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  return true;
}
