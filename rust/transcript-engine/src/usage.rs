//! `transcript-engine usage <absolute path>`: the rows token totals are made of.
//!
//! One record per row whose `type` is `assistant` and whose `message` carries a `usage`
//! object, in file order: `{"type":"assistant","isSidechain":…,"message":{"id":…,"usage":{…}}}`,
//! with `isSidechain` and `id` only when written, and `usage` as written. Its reader is
//! `summarizeClaudeTokenUsage` in `server/modules/providers/services/provider-token-usage.service.ts`.
//! A file that cannot be read is exit 3 with one stderr line.

use std::borrow::Cow;
use std::io::{self, Write};
use std::path::Path;

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::lines::{lines, parse_row, with_file_bytes, Row};
use crate::VerbError;

const ASSISTANT: &str = "assistant";

#[derive(Deserialize)]
struct UsageRow<'a> {
    #[serde(rename = "type", borrow, default)]
    kind: Option<Cow<'a, str>>,
    #[serde(rename = "isSidechain", default)]
    is_sidechain: Option<Value>,
    #[serde(default)]
    message: Option<UsageMessage>,
}

#[derive(Deserialize)]
struct UsageMessage {
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    usage: Option<Value>,
}

struct UsageRecord {
    is_sidechain: Option<Value>,
    id: Option<Value>,
    usage: Map<String, Value>,
}

pub fn run(args: &[String], out: &mut dyn Write) -> Result<(), VerbError> {
    let [path] = args else {
        return Err(VerbError::Job("usage takes exactly one absolute path".into()));
    };
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err(VerbError::Job(format!("usage needs an absolute path, not {}", path.display())));
    }
    with_file_bytes(path, |bytes| write_usage_records(bytes, out))
        .map_err(|error| VerbError::File(format!("{} could not be read: {error}", path.display())))?
}

fn write_usage_records(bytes: &[u8], out: &mut dyn Write) -> Result<(), VerbError> {
    for line in lines(bytes) {
        let record = match parse_row::<UsageRow<'_>>(&line) {
            Some(Row::Typed(row)) => record_of_typed(row),
            Some(Row::Loose(value)) => record_of_loose(value),
            None => None,
        };
        let Some(record) = record else { continue };
        serde_json::to_writer(&mut *out, &record.into_json()).map_err(io::Error::from)?;
        out.write_all(b"\n")?;
    }
    Ok(())
}

fn record_of_typed(row: UsageRow<'_>) -> Option<UsageRecord> {
    if row.kind.as_deref() != Some(ASSISTANT) {
        return None;
    }
    let message = row.message?;
    let Some(Value::Object(usage)) = message.usage else { return None };
    Some(UsageRecord { is_sidechain: row.is_sidechain, id: message.id, usage })
}

/// The same rules over a row the typed shape refused.
fn record_of_loose(mut row: Value) -> Option<UsageRecord> {
    let row = row.as_object_mut()?;
    if row.get("type").and_then(Value::as_str) != Some(ASSISTANT) {
        return None;
    }
    let is_sidechain = row.remove("isSidechain").filter(|value| !value.is_null());
    let Some(Value::Object(mut message)) = row.remove("message") else { return None };
    let Some(Value::Object(usage)) = message.remove("usage") else { return None };
    let id = message.remove("id").filter(|value| !value.is_null());
    Some(UsageRecord { is_sidechain, id, usage })
}

impl UsageRecord {
    fn into_json(self) -> Value {
        let mut message = Map::new();
        if let Some(id) = self.id {
            message.insert("id".into(), id);
        }
        message.insert("usage".into(), Value::Object(self.usage));
        let mut record = Map::new();
        record.insert("type".into(), Value::String(ASSISTANT.into()));
        if let Some(is_sidechain) = self.is_sidechain {
            record.insert("isSidechain".into(), is_sidechain);
        }
        record.insert("message".into(), Value::Object(message));
        Value::Object(record)
    }
}
