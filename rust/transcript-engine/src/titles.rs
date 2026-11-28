//! `transcript-engine titles`: the rows a session's title is picked from.
//!
//! stdin is the job, `{"files":["/abs/a.jsonl", …]}`. One record per file, in input order:
//! `{"i":0,"rows":[…]}` holding every row whose `type` is `custom-title`, `ai-title` or
//! `last-prompt`, each the line as written, in file order; or `{"i":0,"error":"<reason>"}` for a
//! file that cannot be read. Its reader is `pickSessionTitle` in
//! `server/modules/providers/list/claude/claude-session-synchronizer.provider.ts`, through the
//! door's `readTitleRows`. A path that is not absolute refuses the whole job (exit 2): the caller
//! owns the transcript layout, and the engine knows no directory to resolve one against.

use std::borrow::Cow;
use std::io::{self, Read, Write};
use std::path::Path;

use rayon::prelude::*;
use serde::Deserialize;
use serde_json::Value;

use crate::lines::{lines, parse_row, with_file_bytes, Row};
use crate::VerbError;

const TITLE_ROW_TYPES: [&str; 3] = ["custom-title", "ai-title", "last-prompt"];

#[derive(Deserialize)]
struct TitlesJob {
    files: Vec<String>,
}

#[derive(Deserialize)]
struct RowType<'a> {
    #[serde(rename = "type", borrow, default)]
    kind: Option<Cow<'a, str>>,
}

pub fn run(args: &[String], out: &mut dyn Write) -> Result<(), VerbError> {
    if !args.is_empty() {
        return Err(VerbError::Job("titles reads its job from stdin and takes no arguments".into()));
    }
    let job = read_job()?;
    // Every file is read before the first record is written: a title record is a handful of short
    // rows, so holding them all costs little, and collect keeps the input's order.
    let records: Vec<String> = job
        .files
        .par_iter()
        .enumerate()
        .map(|(index, path)| record_of_file(index, Path::new(path)))
        .collect();
    for record in records {
        out.write_all(record.as_bytes())?;
        out.write_all(b"\n")?;
    }
    Ok(())
}

fn read_job() -> Result<TitlesJob, VerbError> {
    let mut text = String::new();
    io::stdin()
        .read_to_string(&mut text)
        .map_err(|error| VerbError::Job(format!("stdin could not be read: {error}")))?;
    let job: TitlesJob = serde_json::from_str(&text)
        .map_err(|error| VerbError::Job(format!("the titles job is not {{\"files\":[…]}}: {error}")))?;
    if let Some(relative) = job.files.iter().find(|path| !Path::new(path).is_absolute()) {
        return Err(VerbError::Job(format!("titles needs absolute paths, not {relative:?}")));
    }
    Ok(job)
}

fn record_of_file(index: usize, path: &Path) -> String {
    match with_file_bytes(path, title_rows) {
        Ok(rows) => format!("{{\"i\":{index},\"rows\":[{}]}}", rows.join(",")),
        Err(error) => {
            let reason = format!("{} could not be read: {error}", path.display());
            serde_json::json!({ "i": index, "error": reason }).to_string()
        }
    }
}

/// The file's title rows, each its trimmed line as written: the line parsed as one JSON object,
/// so it stands in the record's array as it is.
fn title_rows(bytes: &[u8]) -> Vec<String> {
    lines(bytes).filter(|line| is_title_row(line)).map(Cow::into_owned).collect()
}

fn is_title_row(line: &str) -> bool {
    // An array line would fill the typed shape by position; only an object is a row.
    if !line.starts_with('{') {
        return false;
    }
    match parse_row::<RowType<'_>>(line) {
        Some(Row::Typed(row)) => row.kind.as_deref().is_some_and(is_title_type),
        Some(Row::Loose(value)) => value.get("type").and_then(Value::as_str).is_some_and(is_title_type),
        None => false,
    }
}

fn is_title_type(kind: &str) -> bool {
    TITLE_ROW_TYPES.contains(&kind)
}
