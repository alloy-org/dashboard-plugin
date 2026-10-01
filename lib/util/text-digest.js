// Hash text into a short, stable hex string with 32-bit FNV-1a. Identity only: the digest has to be reproducible
// across sessions and host contexts, which rules out crypto APIs the Amplenote host does not guarantee, and it is
// never a security token.

// ----------------------------------------------------------------------------------------------
// @desc Digest text into eight hex characters. Every character counts, so any edit to the text yields a new digest.
// @param {string} text - Text to digest.
// @returns {string} Eight lowercase hex characters.
export function textDigest(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
