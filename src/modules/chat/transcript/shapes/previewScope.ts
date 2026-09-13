import { createContext } from 'react';

/**
 * Which reply a file preview belongs to — the scope its bytes are shared within, and its fold.
 *
 * `useFilePreview` reads a file once per project, path AND scope: a row remounting as it leaves and
 * re-enters its band reuses the bytes it already read, while a LATER reply naming the same path reads
 * the file again. That second half is the point — a screenshot is overwritten on every run, and the
 * newest reply must show the newest bytes, which are the bytes its chip opens. The fold is scoped the
 * same way, so folding one reply's preview leaves the same file's preview in another reply open.
 *
 * Provided by `MessageComponent`, from what survives the id changes a finishing reply goes through
 * (its id changes as it finalises and again when the persisted copy supersedes it, each change
 * remounts the row, and a scope that moved with the id would blank every preview for a re-read and
 * spring every fold open at the moment the reply lands):
 *   * a tool row (a subagent's report, a plan, a markdown result) — `tool:<toolId>`;
 *   * a finished reply — its trimmed text hashed together with its turn anchor, which
 *     `ChatMessagesPane` reads from the FULL message order: the last tool call before it in its turn,
 *     else the turn's prompt. A tool call's id is unique, so the same words in two turns are two
 *     scopes, and no display setting ("Show work", the loaded window) moves it;
 *   * `false` — a reply still streaming, whose text grows every delta. It previews nothing yet; its
 *     chips open their files until the reply is done.
 *
 * `null` for a row with no such identity, and everywhere outside a message (a tool's error, a
 * fixture): a preview then scopes to its own mount and shares nothing. Never a hash of empty text,
 * which every tool row would share.
 */
export const PreviewScopeContext = createContext<string | false | null>(null);
