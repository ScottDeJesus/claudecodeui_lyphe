/**
 * The chat text for a slash command the user typed, rebuilt from the tagged
 * row Claude writes for it (`<command-name>`, `<command-message>`,
 * `<command-args>`). Shared by the transcript normalizer and transcript search
 * so a command reads the same in the chat and in a search hit.
 */

export type LocalCommandPayload = {
  commandName: string;
  commandMessage: string;
  commandArgs: string;
};

/**
 * Commands that only wrap the message they carry. The composer's Plain toggle
 * sends every message as `/plain <text>`; the wrapper is presentation, not
 * something the user said, so the bubble shows the text alone — which is also
 * what lets the optimistic echo of the typed text retire against this row
 * instead of standing beside it as a second bubble.
 */
const TRANSPARENT_WRAPPER_COMMANDS = new Set(['/plain']);

/**
 * `text` with a leading transparent wrapper command taken off (`/plain hello`
 * becomes `hello`); any other text comes back as it was.
 *
 * The tagged row above is only one of the two shapes a wrapped send reaches
 * the transcript in. The CLI expands a slash command in a STRING prompt into
 * the `<command-*>` tags; a message with an image attached is sent as a content
 * ARRAY, which it does not expand, so its text block still reads `/plain hello`.
 * Unwrapped here the same way, the saved row carries the words the user typed —
 * which is what lets the optimistic echo retire against it, and what a search
 * hit shows.
 */
export function stripTransparentWrapperPrefix(text: string): string {
  const trimmed = text.trimStart();
  const wrapper = [...TRANSPARENT_WRAPPER_COMMANDS].find(
    (command) => trimmed.startsWith(command) && /\s/.test(trimmed.charAt(command.length)),
  );
  if (!wrapper) {
    return text;
  }
  const words = trimmed.slice(wrapper.length).trimStart();
  return words || text;
}

/**
 * Prefers the slash-prefixed command name because that most closely matches
 * what the user typed, and falls back to the message body only when the name
 * is unavailable in older transcript variants.
 */
export function localCommandDisplayText(payload: LocalCommandPayload): string {
  const commandName = payload.commandName.trim();
  const commandMessage = payload.commandMessage.trim();
  const commandArgs = payload.commandArgs.trim();
  const baseCommand = commandName || commandMessage;

  if (!baseCommand) {
    return '';
  }

  if (commandArgs && TRANSPARENT_WRAPPER_COMMANDS.has(commandName)) {
    return commandArgs;
  }

  return commandArgs ? `${baseCommand} ${commandArgs}` : baseCommand;
}
