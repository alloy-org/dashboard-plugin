// Bridge browser note deletion to the file-backed development app.

// ----------------------------------------------------------------------------------------------
// @desc Delete a development note and report whether it existed, without hiding filesystem failures.
// @param {object} app - File-backed development app.
// @param {object} req - HTTP request carrying a noteHandle.
// @param {object} res - HTTP response receiving a boolean result or an error.
// @returns {boolean} Whether the handler accepts this request method.
export function handleNoteDeleteApi(app, req, res) {
  if (req.method !== "POST") return false;
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", async () => {
    try {
      const { noteHandle } = JSON.parse(body);
      if (!noteHandle || typeof noteHandle !== "object" || (!noteHandle.uuid && !noteHandle.name)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Note UUID or name required" }));
        return;
      }
      const deleted = await app.deleteNote(noteHandle);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ deleted }));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  return true;
}
