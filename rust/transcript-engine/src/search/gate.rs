//! The gate: a file is read only when every word occurs in its raw bytes, case-insensitively —
//! what 'rg --ignore-case --fixed-strings' answered per word, with the same regex engine under it.

use regex::bytes::{Regex, RegexBuilder};

pub struct Gate {
    words: Vec<Regex>,
}

impl Gate {
    pub fn new(words: &[String]) -> Result<Self, String> {
        let words = words
            .iter()
            .map(|word| {
                RegexBuilder::new(&regex::escape(word))
                    .case_insensitive(true)
                    .build()
                    .map_err(|error| format!("the word {word:?} makes no pattern: {error}"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self { words })
    }

    pub fn admits(&self, bytes: &[u8]) -> bool {
        self.words.iter().all(|word| word.is_match(bytes))
    }
}
