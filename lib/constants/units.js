export const KILOBYTE = 1024;
export const TOKEN_CHARACTERS = 4; // According to the gospel of random HN comment https://news.ycombinator.com/item?id=35841781
// Amplenote's replaceNoteContent throws for content over this many characters.
export const NOTE_WRITE_CHARACTER_LIMIT = 200000;
// The most a dashboard service writes to a note in one call: a backstop just under Amplenote's limit, so an oversized
// write is refused and reported by the service rather than thrown by the host.
export const NOTE_WRITE_BACKSTOP_CHARACTERS = Math.floor(NOTE_WRITE_CHARACTER_LIMIT * 0.95);
