//! One file's hits and each session's summary, row by row. A row's session is its sessionId, or the
//! last row's when it has none; rows of a session the job does not list are skipped. The summary is
//! a summary row's text (a row with no sessionId parks it under its leafUuid until a row whose
//! parentUuid names that leaf), a compact summary's text, else the last user text, else the last
//! assistant text, as the file ends. At most max_per_session hits per session, in line order.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Map, Value};

use super::claude_row::{Role, RowReader};
use super::matcher::Matcher;
use super::row::RowView;

const SUMMARY_TYPE: &str = "summary";

#[derive(Default)]
struct SessionState {
    hit_count: usize,
    pending_summaries: HashMap<String, String>,
    resolved_summary: Option<String>,
    last_user_text: Option<String>,
    last_assistant_text: Option<String>,
}

pub struct FileState<'job> {
    listed: HashSet<&'job str>,
    max_per_session: usize,
    current_session: Option<String>,
    sessions: HashMap<String, SessionState>,
    hits: Vec<Value>,
}

impl<'job> FileState<'job> {
    pub fn new(listed: &'job [String], max_per_session: usize) -> Self {
        Self {
            listed: listed.iter().map(String::as_str).collect(),
            max_per_session,
            current_session: None,
            sessions: HashMap::new(),
            hits: Vec::new(),
        }
    }

    pub fn read_row(&mut self, row: &RowView<'_>, reader: &RowReader, matcher: &Matcher) {
        if let Some(id) = row.session_id.as_deref() {
            if self.current_session.as_deref() != Some(id) {
                self.current_session = Some(id.to_owned());
            }
        }
        let Some(session_id) = self.current_session.as_deref() else { return };
        if !self.listed.contains(session_id) {
            return;
        }
        if !self.sessions.contains_key(session_id) {
            self.sessions.insert(session_id.to_owned(), SessionState::default());
        }
        let Some(state) = self.sessions.get_mut(session_id) else { return };
        note_summary(state, row);

        let Some(message) = reader.searchable_message(row) else { return };
        if state.hit_count < self.max_per_session && matcher.matches(&message.text) {
            state.hit_count += 1;
            self.hits.push(json!({
                "session": session_id,
                "role": message.role.as_str(),
                "text": message.text,
                "timestamp": row.timestamp.as_deref(),
                "uuid": row.uuid.as_deref(),
            }));
        }
        // A compact summary describes the state the resumed session continues from: the most faithful summary.
        if row.is_compact_summary {
            state.resolved_summary = Some(message.text.clone());
        }
        match message.role {
            Role::User => state.last_user_text = Some(message.text),
            Role::Assistant => state.last_assistant_text = Some(message.text),
        }
    }

    pub fn into_record(self, index: usize) -> Value {
        if self.hits.is_empty() {
            return json!({ "i": index });
        }
        let mut summaries = Map::new();
        for (session_id, state) in self.sessions {
            if state.hit_count == 0 {
                continue;
            }
            let summary = state.resolved_summary.or(state.last_user_text).or(state.last_assistant_text);
            summaries.insert(session_id, summary.map_or(Value::Null, Value::String));
        }
        json!({ "i": index, "summaries": summaries, "matches": self.hits })
    }
}

fn note_summary(state: &mut SessionState, row: &RowView<'_>) {
    if row.kind.as_deref() == Some(SUMMARY_TYPE) {
        if let Some(summary) = row.summary.as_deref() {
            if row.session_id.is_some() {
                state.resolved_summary = Some(summary.to_owned());
            } else if let Some(leaf) = row.leaf_uuid.as_deref() {
                state.pending_summaries.insert(leaf.to_owned(), summary.to_owned());
            }
        }
    }
    if state.resolved_summary.is_some() {
        return;
    }
    let Some(parent) = row.parent_uuid.as_deref() else { return };
    if let Some(pending) = state.pending_summaries.get(parent) {
        state.resolved_summary = Some(pending.clone());
    }
}
