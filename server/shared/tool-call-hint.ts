import path from 'node:path';

/** How many characters of a Bash command a one-line hint carries. */
const BASH_HINT_CHARACTERS = 60;

/** The tools whose hint is the file's basename: the folder says little and the line must stay short. */
const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write']);

/** The tools that launch a subagent and name its job in `description`. */
const AGENT_TOOLS = new Set(['Agent', 'Task']);

/** A tool's input as an object. A provider that stores the arguments as a JSON string is read through it; anything else says nothing. */
function inputRecord(toolInput: unknown): Record<string, unknown> {
  if (typeof toolInput === 'string') {
    try {
      const parsed: unknown = JSON.parse(toolInput);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return toolInput !== null && typeof toolInput === 'object' && !Array.isArray(toolInput)
    ? (toolInput as Record<string, unknown>)
    : {};
}

/**
 * One line of `text`: every run of whitespace, line breaks included, becomes a single space, and the ends are
 * trimmed. Consumed by this file's hints and by the companion's house reads (`tools/house-reads.ts`,
 * `tools/chat-activity.ts`), which fold a chat's name and its last words to one line the same way.
 */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A tool call as one short line for a person or a model to scan: the tool's name, then a hint at what it was
 * for. The hint is the Bash command's first 60 characters (cut with an ellipsis), the basename of the file for
 * Read, Edit, MultiEdit and Write, and an Agent's own description. Any other tool is its name alone, and so is a
 * call whose input lacks the field the hint comes from — a call is never dropped for want of one.
 *
 * Consumers: the companion's `tools/transcript-render.ts`, which writes one such line per call of a rendered
 * turn, and the roster's activity line for a working chat (`tools/house-reads.ts`), which says the same thing of
 * the run's latest call.
 */
export function describeToolCall(toolName: string, toolInput: unknown): string {
  const input = inputRecord(toolInput);
  let hint = '';

  if (toolName === 'Bash' && typeof input.command === 'string') {
    // Code points, not UTF-16 units, so a cut never lands inside a character.
    const command = Array.from(oneLine(input.command));
    hint = command.length > BASH_HINT_CHARACTERS ? `${command.slice(0, BASH_HINT_CHARACTERS).join('')}…` : command.join('');
  } else if (FILE_TOOLS.has(toolName) && typeof input.file_path === 'string' && input.file_path.trim()) {
    hint = path.basename(input.file_path.trim());
  } else if (AGENT_TOOLS.has(toolName) && typeof input.description === 'string') {
    hint = oneLine(input.description);
  }

  return hint ? `${toolName} ${hint}` : toolName;
}
