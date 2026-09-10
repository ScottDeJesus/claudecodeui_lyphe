import type { PermissionMode, Tone } from '@/shared/types';

/**
 * How each edit mode reads as a mark: a Verve tone, plus whether anything can reach the files
 * without being asked first.
 *
 * The ladder is "how much happens without you", not five arbitrary colours — `acceptEdits` and
 * `auto` share the warn rung on purpose, because from the outside they are the same news
 * (files change while you watch) and two adjacent ambers would only pretend to be a
 * distinction. Which of the two is running is what the menu is for.
 *
 * `writesUnasked` is the second channel. Doctrine §6: colour is never the whole signal, so on
 * the composer's pill the tone is an outline alone for the modes that stop and ask, and the
 * tone's soft FILL arrives for the modes that do not — a difference that survives a greyscale
 * screen and the two commonest colour deficiencies, which is exactly the boundary a person
 * needs to see at a glance. In the menu, where each row has room for its words, the same two
 * channels are a ring and a filled swatch.
 */
export type PermissionMark = {
  tone: Tone;
  writesUnasked: boolean;
};

const MARKS: Record<PermissionMode, PermissionMark> = {
  // Writes nothing at all until a plan is agreed, so it is neither safe-green nor a warning.
  plan: { tone: 'info', writesUnasked: false },
  default: { tone: 'positive', writesUnasked: false },
  acceptEdits: { tone: 'warn', writesUnasked: true },
  auto: { tone: 'warn', writesUnasked: true },
  bypassPermissions: { tone: 'danger', writesUnasked: true },
};

/**
 * A mode the capability matrix grew past this build gets the neutral ring: an unknown mode is
 * not a safe one, and painting it green or red would both be a claim this build cannot make.
 */
export function permissionMark(mode: PermissionMode): PermissionMark {
  return MARKS[mode] ?? { tone: 'neutral', writesUnasked: false };
}
