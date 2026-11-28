//! A row's visible text and role, as transcript search shows it, branch for branch and in order:
//! refusals first (no content, an API error, a lookalike, the resume placeholder, a role that is not
//! a turn's, a harness-written user row), then a string content (compact summary, local command,
//! local command output, internal content, plain text), then a content array's text blocks.
//! Four of its rules are shared with the chat's own readers; each names its TypeScript twin.

use regex::Regex;
use serde_json::Value;

use super::matcher::{is_js_whitespace, js_trim, js_trim_start};
use super::row::{js_truthy, RowView};

const RESUME_PLACEHOLDER_TEXT: &str = "No response requested.";
const SYNTHETIC_MODEL: &str = "<synthetic>";
/// Rows the harness writes into the chat that are neither typed by the user nor an answer.
const INTERNAL_CONTENT_PREFIXES: [&str; 4] = ["<system-reminder>", "Caveat:", "Invalid API key", "[Request interrupted"];
/// The terminal formatting codes a local command's output carries.
const ANSI_FORMATTING: &str = r"\x1B\[[0-9;?]*[ -/]*[@-~]";

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::User => "user",
            Role::Assistant => "assistant",
        }
    }
}

pub struct SearchableMessage {
    pub text: String,
    pub role: Role,
}

pub struct RowReader {
    /// The caller's TRANSPARENT_WRAPPER_COMMANDS (server/shared/local-commands.ts).
    transparent_wrappers: Vec<String>,
    ansi_formatting: Regex,
}

struct LocalCommand<'a> {
    name: &'a str,
    message: &'a str,
    args: &'a str,
}

impl RowReader {
    pub fn new(transparent_wrappers: Vec<String>) -> Self {
        let ansi_formatting = Regex::new(ANSI_FORMATTING).expect("ANSI_FORMATTING is a fixed, valid pattern");
        Self { transparent_wrappers, ansi_formatting }
    }

    pub fn searchable_message(&self, row: &RowView<'_>) -> Option<SearchableMessage> {
        if !js_truthy(&row.content) || row.is_api_error_message {
            return None;
        }
        // Neither is something said in the chat: a bookkeeping record that wears a turn's shape would
        // surface every prompt a second time, and the CLI's resume stand-in would read as the chat's
        // last assistant text.
        if is_claude_turn_lookalike(row) || is_resume_placeholder_row(row) {
            return None;
        }
        let role = match row.role.as_deref() {
            Some("user") => Role::User,
            Some("assistant") => Role::Assistant,
            _ => return None,
        };
        // A user row the harness wrote (a skill body, hook feedback) is never something the user typed;
        // compact summaries are meta too but are re-labelled as assistant text, so they pass.
        if role == Role::User && row.is_meta && !row.is_compact_summary {
            return None;
        }
        if let Value::String(content) = &row.content {
            return self.string_message(row, content, role);
        }
        let text = extract_claude_text(&row.content);
        if text.is_empty() {
            return None;
        }
        if row.is_compact_summary {
            return Some(SearchableMessage { text, role: Role::Assistant });
        }
        if is_internal_content(&text) {
            return None;
        }
        // A send with an image is a content array the CLI does not expand: its text block still wears
        // the plain-mode '/plain ', which the chat takes off and a hit must too.
        let text = match role {
            Role::User => strip_transparent_wrapper_prefix(&text, &self.transparent_wrappers).to_owned(),
            Role::Assistant => text,
        };
        Some(SearchableMessage { text, role })
    }

    fn string_message(&self, row: &RowView<'_>, content: &str, role: Role) -> Option<SearchableMessage> {
        if row.is_compact_summary && !js_trim(content).is_empty() {
            return Some(SearchableMessage { text: content.to_owned(), role: Role::Assistant });
        }
        if let Some(command) = parse_local_command_payload(content) {
            let text = local_command_display_text(&command, &self.transparent_wrappers);
            return (!text.is_empty()).then_some(SearchableMessage { text, role: Role::User });
        }
        if let Some(stdout) = extract_tagged_content(content, "local-command-stdout") {
            let plain = self.ansi_formatting.replace_all(stdout, "");
            let text = js_trim(&plain);
            return (!text.is_empty()).then(|| SearchableMessage { text: text.to_owned(), role: Role::Assistant });
        }
        if content.is_empty() || is_internal_content(content) {
            return None;
        }
        Some(SearchableMessage { text: content.to_owned(), role })
    }
}

/// Twin of isClaudeTurnLookalike in server/shared/claude-transcript-rows.ts; the two change together.
/// A record carrying a turn's message (a role of user or assistant) without being typed a turn: the
/// CLI's bookkeeping, such as api-request-blob.
fn is_claude_turn_lookalike(row: &RowView<'_>) -> bool {
    matches!(row.role.as_deref(), Some("user" | "assistant")) && !matches!(row.kind.as_deref(), Some("user" | "assistant"))
}

/// Twin of isResumePlaceholderRow in server/shared/claude-transcript-rows.ts; the two change together.
/// The CLI's '<synthetic>' assistant row whose only text is "No response requested.".
fn is_resume_placeholder_row(row: &RowView<'_>) -> bool {
    if row.kind.as_deref() != Some("assistant") || row.model.as_deref() != Some(SYNTHETIC_MODEL) {
        return false;
    }
    match &row.content {
        Value::String(text) => js_trim(text) == RESUME_PLACEHOLDER_TEXT,
        Value::Array(parts) => {
            !parts.is_empty() && parts.iter().all(|part| text_of_part(part).is_some_and(|text| js_trim(text) == RESUME_PLACEHOLDER_TEXT))
        }
        _ => false,
    }
}

/// Twin of localCommandDisplayText in server/shared/local-commands.ts; the two change together.
/// The slash-prefixed name, as the user typed it, else the message body; a transparent wrapper
/// shows only the words it carries.
fn local_command_display_text(command: &LocalCommand<'_>, transparent_wrappers: &[String]) -> String {
    let name = js_trim(command.name);
    let message = js_trim(command.message);
    let args = js_trim(command.args);
    let base = if name.is_empty() { message } else { name };
    if base.is_empty() {
        return String::new();
    }
    if !args.is_empty() && transparent_wrappers.iter().any(|wrapper| wrapper == name) {
        return args.to_owned();
    }
    if args.is_empty() {
        base.to_owned()
    } else {
        format!("{base} {args}")
    }
}

/// Twin of stripTransparentWrapperPrefix in server/shared/local-commands.ts; the two change together.
/// The text with a leading transparent wrapper command taken off ('/plain hello' reads 'hello').
fn strip_transparent_wrapper_prefix<'a>(text: &'a str, transparent_wrappers: &[String]) -> &'a str {
    let trimmed = js_trim_start(text);
    let wrapper = transparent_wrappers
        .iter()
        .find(|wrapper| trimmed.starts_with(wrapper.as_str()) && trimmed[wrapper.len()..].chars().next().is_some_and(is_js_whitespace));
    let Some(wrapper) = wrapper else { return text };
    let words = js_trim_start(&trimmed[wrapper.len()..]);
    if words.is_empty() {
        text
    } else {
        words
    }
}

fn extract_claude_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts.iter().filter_map(text_of_part).collect::<Vec<_>>().join(" "),
        _ => String::new(),
    }
}

/// The text of a '{"type":"text","text":…}' block.
fn text_of_part(part: &Value) -> Option<&str> {
    let part = part.as_object()?;
    if part.get("type")?.as_str()? != "text" {
        return None;
    }
    part.get("text")?.as_str()
}

/// What stands between the first '<tag>' and the first '</tag>' after it.
fn extract_tagged_content<'a>(content: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = content.find(&open)? + open.len();
    let length = content[start..].find(&close)?;
    Some(&content[start..start + length])
}

fn parse_local_command_payload(content: &str) -> Option<LocalCommand<'_>> {
    let name = extract_tagged_content(content, "command-name");
    let message = extract_tagged_content(content, "command-message");
    let args = extract_tagged_content(content, "command-args");
    if name.is_none() && message.is_none() && args.is_none() {
        return None;
    }
    Some(LocalCommand { name: name.unwrap_or(""), message: message.unwrap_or(""), args: args.unwrap_or("") })
}

fn is_internal_content(content: &str) -> bool {
    INTERNAL_CONTENT_PREFIXES.iter().any(|prefix| content.starts_with(prefix))
}
