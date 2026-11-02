//----------------- WHOLE-WORD EDGES FOR SPOKEN TEXT ------------
// Regex fragments (lookarounds, to be built into a pattern with the `u` flag) that decide where a word or phrase in a
// transcript begins and ends. Consumed by the voice module's `transcript-cleanup.ts` (fillers, stutters, repeats) and
// `vocabulary-match.ts` (the misheard-word correction and the TTS respelling), so a word is a word by one rule everywhere.

/**
 * What a letter, digit or word-joining mark on either side of a candidate means: it is part of a longer word. Refuses a letter,
 * a digit, `_`, an apostrophe (straight or curly) and a hyphen, so "uh-huh", "don't" and "re-render" are never cut at a seam.
 */
export const WORD_EDGE_BEFORE = "(?<![\\p{L}\\p{N}_'’-])";
export const WORD_EDGE_AFTER = "(?![\\p{L}\\p{N}_'’-])";

/**
 * A word that stands ON ITS OWN: the edges above, and also never touching a `:`, `/` or `@`, nor a `.` that joins it to a word
 * ("HH:mm:ss", "mm/dd/yyyy", "er.ts", "life/config", "kailee@home.com": the `@` keeps the local part of an address, which a
 * correction would turn into a different address, and a handle, out of reach). A full stop that ends a sentence ("Ask Kailee.")
 * does not join anything.
 */
export const STANDALONE_EDGE_BEFORE = `${WORD_EDGE_BEFORE}(?<![:/@]|[\\p{L}\\p{N}_]\\.)`;
export const STANDALONE_EDGE_AFTER = `${WORD_EDGE_AFTER}(?![:/@]|\\.[\\p{L}\\p{N}_])`;
