import type { TalkBinding } from '@/shared/companion-types';

// The talk button's binding, as one rule: what a press may BIND, what it MATCHES afterwards and what it is
// CALLED on the Settings field. All three live here so that a change to what may be bound is one edit — the
// capture in `CompanionSettingsSection` asks `talkBindingFromEvent`, the listener in `useTalkBinding` asks
// `matchesTalkBinding`, and neither holds a rule of its own.
//
// The server holds the same limits for what it STORES (`checkTalkBinding` in `companion-settings.ts`): a
// function key or a chord with Ctrl, Alt or Meta, and the mouse's buttons 1, 3 and 4. The two are edited
// together; this file imports nothing but the contract's type, so it runs as it stands under `node --import tsx`.

/** The one sentence a key on its own is refused with, said to the person who pressed it. */
const REFUSE_PLAIN_KEY = 'A key on its own fires while you type: hold Ctrl, Alt or Meta with it, or use a function key.';
/** The left button's refusal: every click in the app is one. */
const REFUSE_LEFT_BUTTON = 'The left button is every click: use the middle, back or forward button.';
/** The right button's refusal: it opens the context menu. */
const REFUSE_RIGHT_BUTTON = 'The right button opens the menu: use the middle, back or forward button.';

/** A function key's `KeyboardEvent.code`, `F1` to `F24`. */
const FUNCTION_KEY_CODE = /^F(?:[1-9]|1\d|2[0-4])$/;
/** What a bindable `code` is made of, and how long: the contract's own limit on a key binding's `code`. */
const BINDABLE_CODE = /^[A-Za-z0-9]{1,40}$/;

type BindableMouseButton = Extract<TalkBinding, { kind: 'mouse' }>['button'];

/**
 * The mouse buttons that can be bound, by `MouseEvent.button`, and what the label calls each. The left (0) and
 * right (2) buttons are refused with their own sentence; a button past 4 is not one of the three and is not heard.
 */
const MOUSE_BUTTON_NAMES: Record<BindableMouseButton, string> = { 1: 'middle', 3: 'back', 4: 'forward' };

function isBindableMouseButton(button: number): button is BindableMouseButton {
  return button === 1 || button === 3 || button === 4;
}

/** The keys that are modifiers of a chord, not a chord's key: `Control`, `Alt`, `Shift`, `Meta` and AltGr, either side. */
const MODIFIER_KEY_NAMES: ReadonlySet<string> = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph']);
/** The same keys by `code`, for a layout that names the key something else (`OSLeft` is Meta in older Firefox). */
const MODIFIER_CODE = /^(?:Control|Alt|Shift|Meta|OS)(?:Left|Right)$/;

/** A keydown as this rule reads it: the fields of a `KeyboardEvent` it looks at, `repeat` only where it matters. */
export type TalkKeyEvent = {
  type: 'keydown';
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
};

/** A mousedown as this rule reads it: only `button` of a `MouseEvent`. */
export type TalkMouseEvent = { type: 'mousedown'; button: number };

/** What a press that was heard comes to: a binding that can be saved, or the sentence that says why it cannot. */
export type TalkBindingCapture = { binding: TalkBinding } | { refusal: string };

/** `KeyK` is `K` and `Digit1` is `1`; `Space`, `F8` and `ArrowLeft` are already what they are called. */
function keyNameFromCode(code: string): string {
  return code.replace(/^Key(?=[A-Z]$)/, '').replace(/^Digit(?=\d$)/, '');
}

/** The modifiers held, in the order Ctrl, Alt, Shift, Meta, then the key, joined by `+`: `Ctrl+Alt+Space`. */
function keyLabel(code: string, held: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }): string {
  const modifiers = [held.ctrl && 'Ctrl', held.alt && 'Alt', held.shift && 'Shift', held.meta && 'Meta'];
  return [...modifiers.filter((name): name is string => name !== false), keyNameFromCode(code)].join('+');
}

function bindingFromKey(event: TalkKeyEvent): TalkBindingCapture | null {
  // A modifier on its own is the start of a chord: the capture waits for the key pressed with it.
  if (MODIFIER_KEY_NAMES.has(event.key) || MODIFIER_CODE.test(event.code)) return null;
  // A key the browser cannot name (an empty `code`, as a virtual keyboard sends) has nothing to bind to.
  if (!BINDABLE_CODE.test(event.code)) return null;

  const held = { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
  // Shift does not make a key a shortcut: Shift+K types a capital.
  if (!FUNCTION_KEY_CODE.test(event.code) && !held.ctrl && !held.alt && !held.meta) return { refusal: REFUSE_PLAIN_KEY };

  return { binding: { kind: 'key', code: event.code, ...held, label: keyLabel(event.code, held) } };
}

function bindingFromMouse(event: TalkMouseEvent): TalkBindingCapture | null {
  if (event.button === 0) return { refusal: REFUSE_LEFT_BUTTON };
  if (event.button === 2) return { refusal: REFUSE_RIGHT_BUTTON };

  if (!isBindableMouseButton(event.button)) return null;
  return { binding: { kind: 'mouse', button: event.button, label: `Mouse ${MOUSE_BUTTON_NAMES[event.button]}` } };
}

/**
 * What a press would bind, for the Settings field that is capturing a new binding: the binding to save, the
 * sentence that says why this press cannot be bound, or `null` when the press is not one to answer (a modifier
 * on its own, which starts a chord; a key the browser cannot name; a mouse button past the forward button).
 * Used by `CompanionSettingsSection` (the capture) — `useTalkBinding` holds a binding already and only matches.
 */
export function talkBindingFromEvent(event: TalkKeyEvent | TalkMouseEvent): TalkBindingCapture | null {
  return event.type === 'keydown' ? bindingFromKey(event) : bindingFromMouse(event);
}

/** A keydown of the bound key with exactly the bound modifiers, a repeat or not. */
function isBoundChord(binding: Extract<TalkBinding, { kind: 'key' }>, event: TalkKeyEvent): boolean {
  return (
    event.code === binding.code &&
    event.ctrlKey === binding.ctrl &&
    event.altKey === binding.alt &&
    event.shiftKey === binding.shift &&
    event.metaKey === binding.meta
  );
}

/**
 * Whether this press is the bound one. A keydown matches on `code` and on all four modifiers EXACTLY — Ctrl+Space
 * is not Ctrl+Shift+Space, and F8 is not Shift+F8 — and a `repeat` of a held key never matches, so a held key
 * does not flap the recording. A mousedown matches on `button`. Used by `useTalkBinding`, on every keydown and
 * mousedown of the window it listens on.
 */
export function matchesTalkBinding(binding: TalkBinding, event: TalkKeyEvent | TalkMouseEvent): boolean {
  if (binding.kind === 'mouse') return event.type === 'mousedown' && event.button === binding.button;
  return event.type === 'keydown' && !event.repeat && isBoundChord(binding, event);
}

/**
 * Whether this keydown is the auto-repeat of the bound chord held down: it never presses the button
 * (`matchesTalkBinding` is false for it), and it is still the chord's, so the hook swallows it — a repeat
 * left to the page would hand the browser a held F5 or Ctrl+S. Used by `useTalkBinding`.
 */
export function isTalkBindingRepeat(binding: TalkBinding, event: TalkKeyEvent | TalkMouseEvent): boolean {
  return binding.kind === 'key' && event.type === 'keydown' && event.repeat === true && isBoundChord(binding, event);
}
