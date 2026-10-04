import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge, validators } from 'tailwind-merge';

import { LANES_MIN, SWARM_LADDER_TOP } from '@/shared/constants';
import type { RoadmapFeatureWord, RoadmapPicture } from '@/shared/roadmap-types';
import type { DispatcherModelChoice, Project, ProjectSession } from '@/shared/types';

//----------------- DEPLOYMENT MODE ------------

/**
 * Indicates whether the app runs in Platform mode (hosted) or OSS mode (self-hosted).
 * Read it to hide or gate features that only exist in one of the two deployments.
 */
export const IS_PLATFORM = import.meta.env?.VITE_IS_PLATFORM === 'true';

// ---------------------------

//----------------- TAILWIND CLASS COMPOSITION ------------

/**
 * The merger `cn` runs. It is built through `extendTailwindMerge` — rather than importing
 * `twMerge` — so the rendered transcript's five named text sizes are known as FONT SIZES.
 *
 * tailwind-merge 3 reads an unknown `text-<name>` as a text COLOUR, so an unextended merger
 * answers `cn('text-md-body', 'text-foreground')` with the colour alone: the class list still
 * builds, the element just quietly stops following the reader's chat text size, and no type
 * error ever says so. The five names are `tailwind.config.js`'s `fontSize` — `md-body`,
 * `md-meta`, `md-code`, `md-stat` and `chat-tool`.
 *
 * The bare `outline` is the second place the two versions part. tailwind-merge 3 is written for
 * Tailwind 4, where `outline` is a WIDTH (1px); this app builds on Tailwind 3.4, where `outline` is
 * the STYLE (`outline-style: solid`) and `outline-2` only a width. Unextended, the merger reads
 * `cn('outline outline-2')` as two widths and keeps the last, so the ring is drawn with no style —
 * that is, not at all (measured on the dispatcher's StatusFlow: its selected node lost `outline`).
 * So bare `outline` is moved into the style group, beside `outline-none` and `outline-dashed`.
 */
const twMerge = extendTailwindMerge({
  override: {
    classGroups: {
      'outline-w': [{ outline: [validators.isNumber, validators.isArbitraryVariableLength, validators.isArbitraryLength] }],
    },
  },
  extend: {
    classGroups: {
      'font-size': [{ text: ['md-body', 'md-meta', 'md-code', 'md-stat', 'chat-tool'] }],
      'outline-style': ['outline'],
    },
  },
});

/**
 * Merges conditional class names and resolves conflicting Tailwind utilities so the
 * last-specified utility wins. Use it for every className built from props or state.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------

//----------------- CLIPBOARD ------------

/**
 * Copies text with `document.execCommand`, the only path that works in browsers or
 * contexts where the async Clipboard API is unavailable. Private to `copyTextToClipboard`.
 *
 * The scratch textarea is made, focused and selected in `win`'s own document: `execCommand('copy')`
 * acts on the document that holds the selection, and a textarea appended to a document the reader
 * is not looking at copies nothing.
 */
function fallbackCopyToClipboard(text: string, win: Window): boolean {
  const doc = win.document;
  // A closed window keeps its `document` object but has no body to append to.
  if (!text || !doc?.body) {
    return false;
  }

  const textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  doc.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = doc.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    doc.body.removeChild(textarea);
  }

  return copied;
}

/**
 * Copies text to the clipboard, falling back to a hidden textarea when the Clipboard API
 * is blocked. Resolves to whether the copy succeeded so callers can show copied feedback.
 *
 * `win` is the window the press happened in. The clipboard answers to the FOCUSED document, which
 * for a control drawn in the chat's picture-in-picture window is that window's, not the opener's:
 * the chat's callers pass `useHostWindow()`, and every other caller keeps the default.
 */
export async function copyTextToClipboard(text: string, win: Window = window): Promise<boolean> {
  if (!text) {
    return false;
  }

  let copied = false;

  try {
    const clipboard = win.navigator?.clipboard;
    if (clipboard?.writeText) {
      // A CLOSED window answers `undefined` instead of a promise: the call returns, nothing is copied,
      // and awaiting it would report a copy that never happened (measured 2026-09-29).
      const written: Promise<void> | undefined = clipboard.writeText(text);
      if (written) {
        await written;
        copied = true;
      }
    }
  } catch {
    copied = false;
  }

  if (!copied) {
    copied = fallbackCopyToClipboard(text, win);
  }

  return copied;
}

// ---------------------------

//----------------- NOTIFICATION SOUND ------------

/** localStorage key holding the user's completion-sound preference. Private to the sound helpers. */
const NOTIFICATION_SOUND_ENABLED_STORAGE_KEY = 'notificationSoundEnabled';

/** The browser's AudioContext constructor, including the webkit-prefixed fallback; undefined outside a browser. */
const AudioContextConstructor =
  typeof window !== 'undefined'
    ? window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    : undefined;

/** Lazily created and reused, because browsers cap how many AudioContexts a page may open. */
let audioContext: AudioContext | null = null;

/** Reports whether the user has left completion sounds on; defaults to on when unset. */
export const isNotificationSoundEnabled = (): boolean => {
  if (typeof localStorage === 'undefined') {
    return true;
  }

  return localStorage.getItem(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY) !== 'false';
};

/** Persists the user's completion-sound preference; call it from settings toggles. */
export const setNotificationSoundEnabled = (enabled: boolean): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY, String(enabled));
};

/** Returns the shared AudioContext, creating it on first use. Private to the sound helpers. */
const getAudioContext = (): AudioContext | null => {
  if (!AudioContextConstructor) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextConstructor();
  }

  return audioContext;
};

/** Schedules one synthesized sine tone on the shared context. Private to `playNotificationSound`. */
const playTone = (
  context: AudioContext,
  frequency: number,
  startsAt: number,
  duration: number,
  peakVolume: number,
): void => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startsAt);

  // Shape the volume so the synthesized tone starts and stops cleanly.
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.exponentialRampToValueAtTime(peakVolume, startsAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startsAt);
  oscillator.stop(startsAt + duration + 0.02);
};

/**
 * Plays the two-tone notification chime, honouring the user's preference unless `force`
 * is set (settings previews pass `force` so the user can hear the sound while it is off).
 */
export const playNotificationSound = async ({ force = false } = {}): Promise<void> => {
  if (!force && !isNotificationSoundEnabled()) {
    return;
  }

  const context = getAudioContext();
  if (!context) {
    return;
  }

  try {
    if (context.state === 'suspended') {
      await context.resume();
    }

    const now = context.currentTime;
    playTone(context, 740, now, 0.12, 0.075);
    playTone(context, 988, now + 0.11, 0.16, 0.06);
  } catch (error) {
    // Browsers may block audio until the page receives a user gesture.
    console.warn('Unable to play notification sound:', error);
  }
};

/** Plays the chime for a finished assistant turn; named for the chat call site it serves. */
export const playChatCompletionSound = (options = {}): Promise<void> => playNotificationSound(options);

// ---------------------------

//----------------- DOCUMENT TITLE ------------

/** Browser tab title shown when no project or session is selected. Private to the title helpers. */
const DEFAULT_PAGE_TITLE = 'LypheCLI';

/**
 * Resolves the human-readable label for a session, accounting for Cursor sessions that
 * carry a `name` instead of the summary the other providers return.
 */
export const getSessionTitle = (session: ProjectSession): string => {
  if (session.__provider === 'cursor') {
    return (session.name as string) || 'Untitled Session';
  }

  return (session.summary as string) || 'New Session';
};

/**
 * Builds the browser tab title for the current selection: the session title when one is
 * open, otherwise the project name, otherwise the app name.
 */
export const getPageTitle = (
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): string => {
  if (selectedSession) {
    return getSessionTitle(selectedSession);
  }

  const displayName = selectedProject?.displayName?.trim();
  return displayName ? `${displayName} - ${DEFAULT_PAGE_TITLE}` : DEFAULT_PAGE_TITLE;
};

// ---------------------------

//----------------- BROWSER DOWNLOADS ------------

/**
 * Hands a blob to the browser as a file to save. Use it wherever the app has already fetched
 * bytes through an authenticated route and wants them on the reader's disk — the file tree's
 * download action and the file manager's both do.
 *
 * The anchor has to be in the document for the click to count, and the object URL is revoked
 * immediately after: the browser has taken its own reference by then, and leaving it would hold
 * the whole file in memory for the life of the tab.
 */
export function downloadBlobAsFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
}

// ---------------------------

//----------------- FORMATTING ------------

/** How many days back still reads as a phrase rather than a date. Private to `formatRelativeTime`. */
const RELATIVE_TIME_DAY_LIMIT = 30;

/**
 * Turns an ISO timestamp into the phrase a person reads: `4m ago`, `yesterday`, `2 days ago`,
 * and a plain locale date once it is older than a month. Use it for any "changed" or "last
 * activity" column.
 *
 * A missing or unparseable timestamp is `—`, never a fabricated time and never "now": the
 * file manager's listing shows this straight through, and a row whose `lstat` failed must not
 * claim to have been touched this second.
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }

  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) {
    return '—';
  }

  const seconds = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  if (seconds < 60) {
    return 'just now';
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days === 1) {
    return 'yesterday';
  }
  if (days < RELATIVE_TIME_DAY_LIMIT) {
    return `${days} days ago`;
  }

  return then.toLocaleDateString();
}

/**
 * A UTC stamp as the reader's own short date — `Oct 3`, with the year once it is not this year's —
 * or `null` for no stamp, or one that is not a time. The roadmap's one spelling of a day, so a step
 * phrase (`useStepPhrase`), a path station (`MilestonePath`), the milestone banner (`CelebrationLayer`)
 * and a feature's dates (`FeatureFacts`) all name it alike, in the browser's own locale.
 */
export function formatShortDate(stamp: string | null | undefined): string | null {
  if (!stamp) return null;
  const milliseconds = Date.parse(stamp);
  if (Number.isNaN(milliseconds)) return null;
  const day = new Date(milliseconds);
  const thisYear = day.getFullYear() === new Date().getFullYear();
  return day.toLocaleDateString(undefined, thisYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The last folder of a path — `/home/lyphe/restorly/` reads `restorly` — or the path itself when it
 * has none. A roadmap project's name when the store holds no label for it: `FeatureRow`'s and
 * `FeatureDialog`'s project chip, and `ItemDialog`'s project choices and folder placeholder.
 */
export function folderName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || path;
}

/** The size ladder, largest unit last. Private to `formatBytes`. */
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/**
 * Turns a byte count into the figure a person reads: `31.4 KB`, `248 KB`, `1.8 MB`. Use it
 * anywhere a file's size is shown.
 *
 * `null` is `—` and `0` is `0 B`, and the difference is the point: one means the app never
 * learned the size, the other means the file is genuinely empty. One decimal below 100 and
 * none above it, because `248.0 KB` says nothing `248 KB` does not.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) {
    return '—';
  }

  const safe = Math.max(0, bytes);
  if (safe < 1024) {
    return `${Math.round(safe)} B`;
  }

  let value = safe;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const rounded = value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');
  return `${rounded} ${BYTE_UNITS[unit]}`;
}

// ---------------------------

//----------------- THE ROADMAP PICTURE ------------

/**
 * Each picture's feature index, built on its first ask and shared by every reader after. A WeakMap, so
 * a picture the live bus has replaced takes its index with it. Private to `roadmapFeatureIndex`.
 */
const ROADMAP_FEATURE_INDEXES = new WeakMap<RoadmapPicture, Map<string, { title: string; word: RoadmapFeatureWord }>>();

/**
 * Every feature of a roadmap picture by name — on a roadmap or unplaced — with what a reader of another
 * feature's name needs: its title and its word. Used by `useStepPhrase` (the feature a `waiting` step
 * names) and `FeatureFacts` (each wait of `FeatureDialog`'s feature). A name the index lacks — a feature
 * under an epic no milestone holds is in neither `roadmaps` nor `unplaced` — is said as "another
 * feature", never as its slug.
 */
export function roadmapFeatureIndex(picture: RoadmapPicture): Map<string, { title: string; word: RoadmapFeatureWord }> {
  const known = ROADMAP_FEATURE_INDEXES.get(picture);
  if (known) return known;
  const index = new Map<string, { title: string; word: RoadmapFeatureWord }>();
  for (const roadmap of picture.roadmaps) {
    for (const milestone of roadmap.milestones) {
      for (const epic of milestone.epics) {
        for (const item of epic.features) index.set(item.name, { title: item.title, word: item.word });
      }
    }
  }
  for (const item of picture.unplaced.features) index.set(item.name, { title: item.title, word: item.word });
  ROADMAP_FEATURE_INDEXES.set(picture, index);
  return index;
}

// ---------------------------

//----------------- THE DISPATCHER'S MODEL WORD ------------

/**
 * The model word a plan's or an arc's control shows as pressed: the stored word, or `claude` for a record with
 * none (`null` / absent — a store row carrying no word of its own), because that is how the store itself reads it
 * (`run_model.DEFAULT`). Used by `PlanControls` and `DispatchArcControls` to hand `RunModelControl` its value, so
 * `Chat switch` is pressed only when the record says `auto`.
 */
export function effectiveModelWord(stored: DispatcherModelChoice | null | undefined): DispatcherModelChoice {
  return stored ?? 'claude';
}

// ---------------------------

//----------------- THE DISPATCHER'S SENTENCE ------------

/**
 * The first non-blank line of a dispatcher answer's `stdout`, `stderr` or `error`, trimmed — or `''`
 * for anything that is not text. Blank lines are stepped over rather than returned: a refusal that
 * began with a newline would otherwise raise an empty toast. Used by `useDispatcherVerbs` and
 * `useRoadmapWrites`, the two hooks that show the dispatcher's own sentence in a toast.
 */
export function firstLine(text: unknown): string {
  if (typeof text !== 'string') return '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

// ---------------------------

//----------------- THE SWARM CEILING LADDER ------------

/**
 * The top counted rung of the swarm ladder (`1, 2, … top, All`): `SWARM_LADDER_TOP`, or the widest count
 * already in play — the box's, the plan's own — whichever is larger. On the plan card the box's count is
 * always in play, so a box count above six stays a rung however the plan's own count moves; on the
 * Settings row the row's own count is the only one in play, so a count above six steps down by one and,
 * once stepped below it, is not climbed back to. `null` is `All` (no ceiling) and widens nothing. Because every count the ladder
 * ever steps to is at most this, `+` can never produce a count wider than one the server already
 * handed us (and so never one the swarm reader refuses). Used by the dispatcher module's `SwarmControl`
 * and the settings module's `RunnerModelContent`, which hand its answer to `swarmLadderSteps`.
 */
export function swarmLadderTop(...inPlay: Array<number | null>): number {
  return Math.max(SWARM_LADDER_TOP, ...inPlay.filter((lanes): lanes is number => lanes !== null));
}

/**
 * Where `−` and `+` land from `current` on the one swarm ladder, `1, 2, … top, All`; `null` is `All`
 * (the box's bare `on`, Settings' `Unlimited`). A press that is refused is `null`; a press that lands is
 * `{ lanes }`, where `lanes: null` is `All`.
 *
 * `+` adds one below `top`, and from `top` goes to `All`; it is refused on `All`. `−` takes `All` to
 * `top`, and subtracts one from a count; it is refused on one lane. Used by the dispatcher module's
 * `SwarmControl` (one plan's own word) and the settings module's `RunnerModelContent` (the box's
 * switch), so the two climb the same ladder from one copy of the rules.
 */
export function swarmLadderSteps(
  current: number | null,
  top: number,
): { down: { lanes: number | null } | null; up: { lanes: number | null } | null } {
  if (current === null) return { down: { lanes: top }, up: null };
  return {
    down: current > LANES_MIN ? { lanes: current - 1 } : null,
    up: { lanes: current < top ? current + 1 : null },
  };
}

// ---------------------------

//----------------- KEYBOARD SHORTCUTS ------------

/**
 * Whether the page runs on an Apple platform, where the command key (⌘) is the shortcut modifier
 * and Ctrl is not. The one platform check the house makes for shortcuts; read it through
 * `modifierKeyLabel` and `formatShortcut` rather than testing `navigator.platform` again. False
 * where there is no `navigator` at all.
 */
export function isApplePlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

/** The modifier a shortcut is printed with on this platform: `⌘` on Apple hardware, `Ctrl` elsewhere. */
export function modifierKeyLabel(): '⌘' | 'Ctrl' {
  return isApplePlatform() ? '⌘' : 'Ctrl';
}

/**
 * A shortcut as a person reads it here: `⌘K` on a Mac, `Ctrl+K` elsewhere. Pass the key as it
 * should print (`'K'`, `'.'`); the modifier is this platform's.
 */
export function formatShortcut(key: string): string {
  return isApplePlatform() ? `⌘${key}` : `Ctrl+${key}`;
}

// ---------------------------

//----------------- DOM TESTS AND OBSERVERS THAT SURVIVE A WINDOW MOVE ------------

/**
 * Whether an event target is a DOM node, by asking the node instead of its constructor.
 *
 * Why not `target instanceof Node`: an element created while the chat lives in a picture-in-picture
 * window belongs to THAT window's realm, whose `Node` is not this page's — the test answers false for
 * a real node, and the handler behind it quietly does nothing. `nodeType` is a plain number every
 * node carries whichever window made it. Used by the kit's Tooltip.
 */
export function isNodeLike(target: EventTarget | null | undefined): target is Node {
  return target != null && typeof (target as Node).nodeType === 'number';
}

/**
 * Whether an event target is a DOM element, by its `nodeType` (1) rather than `instanceof Element`
 * — see `isNodeLike` for why a constructor test lies about an element drawn in another window.
 * Used by the kit's Lightbox to find the control a press began on.
 */
export function isElementLike(target: EventTarget | null | undefined): target is Element {
  return target != null && (target as Node).nodeType === 1;
}

/**
 * A ResizeObserver built by `hostWindow`'s own constructor, or null where that window has none.
 *
 * Why not `new ResizeObserver(...)`: an observer delivers on the frame lifecycle of the window whose
 * constructor built it, not of the window its target is drawn in. Measured in Chromium (2026-09-29):
 * six resizes of an element in a picture-in-picture window reached an observer built by the PiP's
 * constructor six times, and one built by the opener's constructor NOT ONCE until the opener happened
 * to draw frames of its own — and a hidden opener draws none, which is exactly when the reader is
 * looking at the floating window. Build it from `useHostWindow()` and put that window in the effect's
 * dependencies, so a move builds a new one. Used by the kit's Tabs and `useZoomPan`.
 */
export function resizeObserverIn(hostWindow: Window, callback: ResizeObserverCallback): ResizeObserver | null {
  const HostResizeObserver = (hostWindow as Window & typeof globalThis).ResizeObserver;
  return typeof HostResizeObserver === 'function' ? new HostResizeObserver(callback) : null;
}
