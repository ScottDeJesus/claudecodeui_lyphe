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
