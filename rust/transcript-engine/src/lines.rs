//! File to lines to rows, the one reading rule every verb shares.
//!
//! A file is read whole (no mmap: a transcript being appended to must not change under a borrow)
//! into a buffer its thread reuses. A line ends at a newline; surrounding ASCII whitespace, a
//! trailing carriage return included, is dropped; a blank line is skipped; bytes that are not
//! UTF-8 are decoded lossily; a line that does not parse is skipped.

use std::borrow::Cow;
use std::cell::RefCell;
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use serde::Deserialize;
use serde_json::Value;

thread_local! {
    static FILE_BUFFER: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Reads `path` whole into this thread's reusable buffer and hands its bytes to `read`.
///
/// The buffer leaves its slot for the call and goes back after it, so a nested read on the same
/// thread (rayon may run another file's task here while this one waits) starts a fresh buffer
/// instead of panicking on a second borrow.
pub fn with_file_bytes<T>(path: &Path, read: impl FnOnce(&[u8]) -> T) -> io::Result<T> {
    let mut buffer = FILE_BUFFER.with(|slot| std::mem::take(&mut *slot.borrow_mut()));
    buffer.clear();
    let filled = File::open(path).and_then(|mut file| file.read_to_end(&mut buffer));
    let answer = filled.map(|_| read(&buffer));
    FILE_BUFFER.with(|slot| *slot.borrow_mut() = buffer);
    answer
}

/// The file's non-blank lines, trimmed and decoded, in file order.
pub fn lines(bytes: &[u8]) -> impl Iterator<Item = Cow<'_, str>> {
    let mut start = 0;
    let line_ends = memchr::memchr_iter(b'\n', bytes).chain(std::iter::once(bytes.len()));
    line_ends.filter_map(move |end| {
        let line = bytes[start..end].trim_ascii();
        start = end + 1;
        if line.is_empty() {
            None
        } else {
            Some(String::from_utf8_lossy(line))
        }
    })
}

/// A parsed row: the typed shape, borrowing from its line and skipping unknown fields, or, for a
/// row that shape refuses (a field of an unexpected type), the plain value, read by the same rules.
pub enum Row<Typed> {
    Typed(Typed),
    Loose(Value),
}

/// Parses one line; `None` for a line that is not JSON at all.
pub fn parse_row<'line, Typed: Deserialize<'line>>(line: &'line str) -> Option<Row<Typed>> {
    if let Ok(typed) = serde_json::from_str::<Typed>(line) {
        return Some(Row::Typed(typed));
    }
    serde_json::from_str::<Value>(line).ok().map(Row::Loose)
}
