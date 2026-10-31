// What `useEars` knows of its page, as plain rules: the per-device switch in storage, the sentences of a page that cannot listen,
// and the one state the switch row draws. No React and no browser objects are made here, so the rule that picks the state is
// readable on its own.
import type { CompanionEarsState } from '@/shared/types';

/** The localStorage key of this device's ears switch: 'on' listens, anything else (or nothing) is off. Ears are off by default. */
const EARS_SWITCH_KEY = 'companion-ears';

/** The mic recorder's own sentences (`useMicRecorder`), said again here since that hook stays as it is. */
export const MICROPHONE_DENIED = 'Microphone access denied.';
export const NO_MICROPHONE = 'No microphone found.';
/** A page without `navigator.mediaDevices` or `AudioWorklet` is not a secure context (plain HTTP on a LAN address, say). */
export const NOT_SECURE = 'This page cannot use the microphone: it is not a secure context.';

/** Whether this device's switch is on. A storage that refuses the read is off. */
export function readEarsSwitch(): boolean {
  try {
    return window.localStorage.getItem(EARS_SWITCH_KEY) === 'on';
  } catch {
    // Storage refused the read: off, the safe side for a microphone.
    return false;
  }
}

/** Whether a `storage` event (which a page hears only for another tab's writes) is a change of this device's ears switch: its own key, or a whole storage cleared. */
export function isEarsSwitchChange(event: StorageEvent): boolean {
  return event.key === null || event.key === EARS_SWITCH_KEY;
}

/** Keeps the switch for this device. */
export function writeEarsSwitch(on: boolean): void {
  try {
    window.localStorage.setItem(EARS_SWITCH_KEY, on ? 'on' : 'off');
  } catch {
    // Storage refused the write: the switch holds for this page's life only.
  }
}

/** Whether this page can listen at all: a secure context hands out `navigator.mediaDevices`, and the capture needs `AudioWorklet`. */
export function canUseMicrophone(): boolean {
  return typeof navigator !== 'undefined' && navigator.mediaDevices !== undefined && typeof AudioWorklet !== 'undefined';
}

/** The recorder's sentence for a mic that would not open: denied, none found, or the browser's own message. */
export function microphoneSentence(failure: unknown): string {
  const named = failure as { name?: string; message?: string } | null;
  if (named?.name === 'NotAllowedError') return MICROPHONE_DENIED;
  if (named?.name === 'NotFoundError') return NO_MICROPHONE;
  return `Mic error: ${named?.message || String(failure)}`;
}

/** Everything the state is read from. */
export type EarsConditions = {
  /** The switch. */
  on: boolean;
  /** `canUseMicrophone()` on this page. */
  capable: boolean;
  /** The sentence of the last thing that went wrong (the mic refused or went away, the worker failed), else null. */
  failure: string | null;
  /** Whether the picture says this page holds the floor. */
  holdsFloor: boolean;
  /** Whether the page has had its first touch (or the switch's own press), so its audio context runs. */
  touched: boolean;
  /** Whether the mic is open into the ears, the models loaded. */
  listening: boolean;
  /** Whether a name press is open. */
  hearing: boolean;
};

/**
 * What the switch row draws: the first of these that holds. `off` (the switch), `unavailable` (the page cannot listen, or the mic
 * or the worker failed; `reason` says why), `elsewhere` (another page holds the floor), `needs-touch`, `readying` (the models
 * loading or the mic opening), `hearing` (a name press is open), else `waiting`.
 */
export function earsStateOf(conditions: EarsConditions): { state: CompanionEarsState; reason: string | null } {
  if (!conditions.on) return { state: 'off', reason: null };
  if (!conditions.capable) return { state: 'unavailable', reason: NOT_SECURE };
  if (conditions.failure !== null) return { state: 'unavailable', reason: conditions.failure };
  if (!conditions.holdsFloor) return { state: 'elsewhere', reason: null };
  if (!conditions.touched) return { state: 'needs-touch', reason: null };
  if (!conditions.listening) return { state: 'readying', reason: null };
  return { state: conditions.hearing ? 'hearing' : 'waiting', reason: null };
}
