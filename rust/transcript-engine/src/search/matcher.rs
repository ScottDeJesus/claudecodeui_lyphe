//! The match test of 'matchesQuery' ('createWordMatcher' in
//! server/modules/providers/services/session-conversations-search.service.ts), in its order. First the
//! words, regex-escaped and joined by one or more of JavaScript's '\s' characters, case-insensitive,
//! on the text. Then, only for a one-word query the first refused, the word with no letter on either
//! side in the lowercased text. The server judges every returned text again with that matcher.

use regex::{Regex, RegexBuilder};

/// JavaScript's '\s': WhiteSpace and LineTerminator. Rust's '\s' is Unicode White_Space, which adds
/// U+0085 and leaves out U+FEFF, so the class is spelled out.
const JS_WHITESPACE_CLASS: &str = r"[\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]";

pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{B}' | '\u{C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

/// JavaScript's String.prototype.trim.
pub fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_whitespace)
}

/// JavaScript's String.prototype.trimStart.
pub fn js_trim_start(text: &str) -> &str {
    text.trim_start_matches(is_js_whitespace)
}

pub struct Matcher {
    phrase: Regex,
    /// The word of a one-word query; a query of several words is the phrase test alone.
    lone_word: Option<String>,
    letter: Regex,
}

impl Matcher {
    pub fn new(words: &[String]) -> Result<Self, String> {
        let separator = format!("{JS_WHITESPACE_CLASS}+");
        let pattern = words.iter().map(|word| regex::escape(word)).collect::<Vec<_>>().join(&separator);
        let phrase = RegexBuilder::new(&pattern)
            .case_insensitive(true)
            .build()
            .map_err(|error| format!("the words make no pattern: {error}"))?;
        let letter = Regex::new(r"^\p{L}$").map_err(|error| format!("the letter class makes no pattern: {error}"))?;
        let lone_word = if words.len() == 1 { Some(words[0].clone()) } else { None };
        Ok(Self { phrase, lone_word, letter })
    }

    pub fn matches(&self, text: &str) -> bool {
        if text.is_empty() {
            return false;
        }
        if self.phrase.is_match(text) {
            return true;
        }
        let Some(word) = &self.lone_word else { return false };
        self.has_unbounded_by_letters(&text.to_lowercase(), word)
    }

    /// Every occurrence is tried, overlapping ones included, as a regex with lookarounds would.
    fn has_unbounded_by_letters(&self, lowered: &str, word: &str) -> bool {
        let mut from = 0;
        while let Some(offset) = lowered[from..].find(word) {
            let start = from + offset;
            let end = start + word.len();
            let before = lowered[..start].chars().next_back();
            let after = lowered[end..].chars().next();
            if !before.is_some_and(|c| self.is_letter(c)) && !after.is_some_and(|c| self.is_letter(c)) {
                return true;
            }
            from = start + lowered[start..].chars().next().map_or(1, char::len_utf8);
        }
        false
    }

    fn is_letter(&self, c: char) -> bool {
        let mut buffer = [0u8; 4];
        self.letter.is_match(c.encode_utf8(&mut buffer))
    }
}
