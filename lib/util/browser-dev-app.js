/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: Browser-side dev app adapter wrapping dev server API endpoints
 * Prompt summary: "dev-app.js becomes equivalent to the plugin API; browser adapter wraps fetch calls"
 */

// [Claude] Task: browser-side app object mirroring Amplenote plugin app interface via dev server
// Prompt: "initialize the component with an app object that it can use to call app.findNote"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function _resolveUUID(noteHandle) {
  return typeof noteHandle === "string" ? noteHandle : noteHandle?.uuid;
}

function _parseHeadingsFromMarkdown(content) {
  const matches = content.match(/^(#{1,6})\s+(.+)$/gm) || [];
  return matches.map((line, i) => ({
    heading: {
      text: line.replace(/^#{1,6}\s+/, '').trim(),
      level: (line.match(/^#+/) || [''])[0].length,
    },
    index: i,
  }));
}

let _instance = null;

export function createBrowserDevApp() {
  if (_instance) return _instance;

  _instance = {
    async findNote(params = {}) {
      try {
        const qs = params.uuid
          ? `uuid=${encodeURIComponent(params.uuid)}`
          : `name=${encodeURIComponent(params.name)}`;
        const res = await fetch(`/api/note-find?${qs}`);
        const data = await res.json();
        return data?.uuid ? data : null;
      } catch {
        return null;
      }
    },

    async createNote(name, tags = []) {
      try {
        const res = await fetch('/api/note-create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, tags }),
        });
        const data = await res.json();
        return data.uuid;
      } catch {
        return null;
      }
    },

    async getNoteContent(noteHandle) {
      const uuid = _resolveUUID(noteHandle);
      try {
        const res = await fetch(`/api/note-content?uuid=${encodeURIComponent(uuid)}`);
        const data = await res.json();
        return data.content ?? '';
      } catch {
        return '';
      }
    },

    async getNoteSections(noteHandle) {
      const content = await this.getNoteContent(noteHandle);
      return _parseHeadingsFromMarkdown(content);
    },

    async replaceNoteContent(noteHandle, content, options = {}) {
      const uuid = _resolveUUID(noteHandle);
      try {
        const payload = { uuid, content };
        if (options.section) payload.section = options.section;
        const res = await fetch('/api/note-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        return data.ok || false;
      } catch {
        return false;
      }
    },

    async insertNoteContent(noteHandle, content, options = {}) {
      const uuid = _resolveUUID(noteHandle);
      try {
        await fetch('/api/note-append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid, content, atEnd: !!options.atEnd }),
        });
      } catch {
        // silent failure in dev
      }
    },
  };

  return _instance;
}
