//! One transcript row as search reads it. The typed shape borrows from its line and skips unknown
//! fields; a row it refuses (a field of an unexpected type) is read from its plain value by the same
//! rules. Those rules are JavaScript's, as the search reader wrote them: a field tested for truth
//! counts only when truthy, a flag tested with '=== true' only when it is true.

use std::borrow::Cow;

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::lines::{parse_row, Row};

pub struct RowView<'a> {
    /// 'type', when it is a string: it is only ever compared.
    pub kind: Option<Cow<'a, str>>,
    pub session_id: Option<Cow<'a, str>>,
    pub uuid: Option<Cow<'a, str>>,
    pub parent_uuid: Option<Cow<'a, str>>,
    pub leaf_uuid: Option<Cow<'a, str>>,
    pub timestamp: Option<Cow<'a, str>>,
    pub summary: Option<Cow<'a, str>>,
    pub is_meta: bool,
    pub is_compact_summary: bool,
    pub is_api_error_message: bool,
    /// 'message.role' and 'message.model', when strings.
    pub role: Option<Cow<'a, str>>,
    pub model: Option<Cow<'a, str>>,
    /// 'message.content'; null when the row has no message or the message no content.
    pub content: Value,
}

#[derive(Deserialize)]
struct TypedRow<'a> {
    #[serde(rename = "type", borrow, default)]
    kind: Option<Cow<'a, str>>,
    #[serde(rename = "sessionId", borrow, default)]
    session_id: Option<Cow<'a, str>>,
    #[serde(borrow, default)]
    uuid: Option<Cow<'a, str>>,
    #[serde(rename = "parentUuid", borrow, default)]
    parent_uuid: Option<Cow<'a, str>>,
    #[serde(rename = "leafUuid", borrow, default)]
    leaf_uuid: Option<Cow<'a, str>>,
    #[serde(borrow, default)]
    timestamp: Option<Cow<'a, str>>,
    #[serde(borrow, default)]
    summary: Option<Cow<'a, str>>,
    #[serde(rename = "isMeta", default)]
    is_meta: Option<bool>,
    #[serde(rename = "isCompactSummary", default)]
    is_compact_summary: Option<bool>,
    #[serde(rename = "isApiErrorMessage", default)]
    is_api_error_message: Option<bool>,
    #[serde(borrow, default)]
    message: Option<TypedMessage<'a>>,
}

#[derive(Deserialize)]
struct TypedMessage<'a> {
    #[serde(borrow, default)]
    role: Option<Cow<'a, str>>,
    #[serde(borrow, default)]
    model: Option<Cow<'a, str>>,
    #[serde(default)]
    content: Option<Value>,
}

/// One line as a row; None for a line that is not JSON or not an object.
pub fn parse(line: &str) -> Option<RowView<'_>> {
    match parse_row::<TypedRow<'_>>(line) {
        Some(Row::Typed(row)) => Some(view_of_typed(row)),
        Some(Row::Loose(value)) => view_of_loose(value),
        None => view_of_loose(serde_json::from_str(&without_lone_surrogates(line)?).ok()?),
    }
}

/// The line with each unpaired surrogate escape ('\ud83d' with no low half, as truncated tool output
/// writes) read as '�'. JSON.parse accepts such a line and JavaScript draws the unit as U+FFFD;
/// serde_json refuses the whole line, which would drop a row the chat shows. None when the line holds
/// no such escape, so a line that is simply not JSON stays skipped.
fn without_lone_surrogates(line: &str) -> Option<String> {
    let bytes = line.as_bytes();
    let mut repaired = String::with_capacity(line.len());
    let mut copied_to = 0;
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] != b'\\' {
            at += 1;
            continue;
        }
        // Any other escape, '\\' included, is two bytes and skipped whole.
        let Some(unit) = escaped_unit(bytes, at) else {
            at += 2;
            continue;
        };
        let pairs_with_next = (0xD800..0xDC00).contains(&unit)
            && escaped_unit(bytes, at + 6).is_some_and(|next| (0xDC00..0xE000).contains(&next));
        if pairs_with_next {
            at += 12;
            continue;
        }
        if (0xD800..0xE000).contains(&unit) {
            repaired.push_str(&line[copied_to..at]);
            repaired.push_str("\\ufffd");
            copied_to = at + 6;
        }
        at += 6;
    }
    if copied_to == 0 {
        return None;
    }
    repaired.push_str(&line[copied_to..]);
    Some(repaired)
}

/// The UTF-16 unit of the '\uXXXX' escape that starts at 'at'.
fn escaped_unit(bytes: &[u8], at: usize) -> Option<u32> {
    if bytes.get(at) != Some(&b'\\') || bytes.get(at + 1) != Some(&b'u') {
        return None;
    }
    let hex = bytes.get(at + 2..at + 6)?;
    if !hex.iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    u32::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()
}

/// JavaScript's truthiness of a JSON value.
pub fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

fn view_of_typed(row: TypedRow<'_>) -> RowView<'_> {
    let (role, model, content) = match row.message {
        Some(message) => (message.role, message.model, message.content.unwrap_or(Value::Null)),
        None => (None, None, Value::Null),
    };
    RowView {
        kind: row.kind,
        session_id: truthy(row.session_id),
        uuid: truthy(row.uuid),
        parent_uuid: truthy(row.parent_uuid),
        leaf_uuid: truthy(row.leaf_uuid),
        timestamp: truthy(row.timestamp),
        summary: truthy(row.summary),
        is_meta: row.is_meta == Some(true),
        is_compact_summary: row.is_compact_summary == Some(true),
        is_api_error_message: row.is_api_error_message == Some(true),
        role,
        model,
        content,
    }
}

fn view_of_loose(value: Value) -> Option<RowView<'static>> {
    let Value::Object(mut row) = value else { return None };
    let (role, model, content) = match row.remove("message") {
        Some(Value::Object(mut message)) => (
            string_field(&message, "role"),
            string_field(&message, "model"),
            message.remove("content").unwrap_or(Value::Null),
        ),
        _ => (None, None, Value::Null),
    };
    Some(RowView {
        kind: string_field(&row, "type"),
        session_id: truthy_text(row.get("sessionId")),
        uuid: truthy_text(row.get("uuid")),
        parent_uuid: truthy_text(row.get("parentUuid")),
        leaf_uuid: truthy_text(row.get("leafUuid")),
        timestamp: truthy_text(row.get("timestamp")),
        summary: truthy_text(row.get("summary")),
        is_meta: row.get("isMeta") == Some(&Value::Bool(true)),
        is_compact_summary: row.get("isCompactSummary") == Some(&Value::Bool(true)),
        is_api_error_message: row.get("isApiErrorMessage").is_some_and(js_truthy),
        role,
        model,
        content,
    })
}

fn truthy(text: Option<Cow<'_, str>>) -> Option<Cow<'_, str>> {
    text.filter(|text| !text.is_empty())
}

fn string_field(object: &Map<String, Value>, key: &str) -> Option<Cow<'static, str>> {
    object.get(key)?.as_str().map(|text| Cow::Owned(text.to_owned()))
}

/// A truthy value as String() writes it; no transcript writes these fields as anything but strings,
/// so a number or a flag is the most a row the typed shape refused carries.
fn truthy_text(value: Option<&Value>) -> Option<Cow<'static, str>> {
    let value = value.filter(|value| js_truthy(value))?;
    Some(Cow::Owned(match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }))
}
