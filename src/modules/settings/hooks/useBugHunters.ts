import { useCallback, useEffect, useRef, useState } from 'react';

import { readHuntsSettings, writeHuntsSettings, type BugHuntsChange } from '@/modules/settings/hooks/bugHuntersWire';

/** The five hunts, in the order the dispatcher ships them (`hunt_config.KINDS`). `RunnerBugHuntersRow` has a name and a sentence for each. */
export const BUG_HUNTER_KINDS = ['security', 'behaviour', 'ui', 'data', 'code'] as const;
export type BugHunterKind = (typeof BUG_HUNTER_KINDS)[number];

/** The three rules for how the hunters take turns (`hunt_config.TURNS`). `RunnerBugHuntersRow` has a name and a sentence for each. */
export const BUG_HUNTER_TURN_RULES = ['project', 'hunter', 'nightly'] as const;
export type BugHunterTurnRule = (typeof BUG_HUNTER_TURN_RULES)[number];

/** The bounds the dispatcher holds a night's minutes to. The row prints them over its field. */
export const BUG_HUNTERS_MINUTES_MIN = 15;
export const BUG_HUNTERS_MINUTES_MAX = 600;

/** The bounds the dispatcher holds a night's tickets to. The row prints them over its field. */
export const BUG_HUNTERS_TICKETS_MIN = 1;
export const BUG_HUNTERS_TICKETS_MAX = 50;

/** The settings of the section, by name: what a refusal is filed under, so its sentence is drawn under the control that earned it. */
export type BugHuntersField = 'nightly' | 'start' | 'minutes' | 'tickets' | 'hunters' | 'projects' | 'turns';

/** The three settings that are typed: a draft while the field is open, written when it is left. */
export type BugHuntersTypedField = 'start' | 'minutes' | 'tickets';

/** One hunter as the row draws it: its kind, and whether it takes a turn (it is in the file's `order`). */
export type BugHunter = { kind: BugHunterKind; takesTurn: boolean };

/** One project the hunters go through: its name and its folder, as `charters/hunts.toml` holds them. */
export type BugHuntProject = { name: string; path: string };

/** `~/.claude/charters/hunts.toml` as the dispatcher last answered it, shaped for the row. */
export type BugHuntsConfig = {
  /** Whether a night starts by itself. */
  nightly: boolean;
  /** When the night starts, `HH:MM` in the box's local time. */
  start: string;
  /** How many minutes the hunters work in one night. */
  minutes: number;
  /** How many tickets a hunter may file in one night. */
  tickets: number;
  /** All five hunters: the ones that take turns first, in turn order, then the ones that sit out. */
  hunters: BugHunter[];
  /** The projects, in the order the hunters go through them. */
  projects: BugHuntProject[];
  /** How the hunters take turns. */
  turns: BugHunterTurnRule;
};

export type BugHunters = {
  /** The settings as the dispatcher last answered, or `null` while no read has succeeded. */
  config: BugHuntsConfig | null;
  /** True once a read has failed: the settings are unknown, which is not the same as their defaults. */
  unreadable: boolean;
  /** True while a write is in flight. */
  saving: boolean;
  /** What each typed field draws: the operator's own typing while a draft is open, otherwise the saved value. Empty while `config` is `null`. */
  texts: Record<BugHuntersTypedField, string>;
  /**
   * The dispatcher's own reason for the last change it refused, by the setting that was refused. A refused value has already snapped
   * back to the saved one; its reason stands until that setting is changed again.
   *
   * THE REASON, NOT THE COMMAND'S LINE. The dispatcher prints `REFUSED hunt config: minutes must be a whole number from 15 to 600, not
   * 900`, and the route hands that line on whole. `REFUSED hunt config: ` is the command's own lead and no word for the operator, so
   * it is dropped here and what is kept starts with a capital: `Minutes must be a whole number from 15 to 600, not 900`. The row puts
   * `Not saved.` in front of it. A line that does not open with that lead is kept as it came.
   */
  refusals: Partial<Record<BugHuntersField, string>>;
  /** Turn the nightly run on or off. */
  setNightly: (next: boolean) => Promise<void>;
  /** Keep what the operator typed into a typed field as a draft; nothing is written, and that field's refusal falls. */
  typeField: (field: BugHuntersTypedField, text: string) => void;
  /** A typed field was left: write its draft. A blank draft is dropped and writes nothing. */
  leaveField: (field: BugHuntersTypedField) => void;
  /** Let a hunter take a turn (it joins the end of the order) or sit out (it leaves the order). */
  setHunterTurn: (kind: BugHunterKind, takesTurn: boolean) => Promise<void>;
  /** Move a hunter that takes a turn one place earlier (`-1`) or later (`1`). */
  moveHunter: (kind: BugHunterKind, by: -1 | 1) => Promise<void>;
  /** Write the turn order a carry made: the kinds that take a turn, in their new order. Answers whether the dispatcher took it. */
  reorderHunters: (order: readonly string[]) => Promise<boolean>;
  /** Move a project one place earlier (`-1`) or later (`1`). */
  moveProject: (name: string, by: -1 | 1) => Promise<void>;
  /** Write the project order a carry made: every project's name, in the new order. Answers whether the dispatcher took it. */
  reorderProjects: (order: readonly string[]) => Promise<boolean>;
  /** Pick how the hunters take turns. */
  setTurns: (next: BugHunterTurnRule) => Promise<void>;
  /** Ask the dispatcher again: the way out of unreadable settings. */
  refresh: () => Promise<void>;
};

/** Narrows a value read from the file to a hunter kind; the file does not promise one. */
function isKind(value: unknown): value is BugHunterKind { return BUG_HUNTER_KINDS.some((kind) => kind === value); }

/** Narrows a value read from the file to a turn rule; the file does not promise one. */
function isTurnRule(value: unknown): value is BugHunterTurnRule { return BUG_HUNTER_TURN_RULES.some((rule) => rule === value); }

/** Narrows an unknown answer to an object its fields can be read from: not `null`, not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The row's hunters from the file's `order`: the kinds that take turns first, in that order, then the rest sitting out. */
function huntersOf(order: readonly unknown[]): BugHunter[] {
  const turning: BugHunterKind[] = [];
  for (const value of order) if (isKind(value) && !turning.includes(value)) turning.push(value);
  const sitting = BUG_HUNTER_KINDS.filter((kind) => !turning.includes(kind));
  return [...turning.map((kind) => ({ kind, takesTurn: true })), ...sitting.map((kind) => ({ kind, takesTurn: false }))];
}

/** The answer as a config, or `null` when a field is missing or of the wrong shape: a default must never draw as the file. */
function configOf(body: unknown): BugHuntsConfig | null {
  if (!isRecord(body)) return null;
  const { nightly, start, minutes, tickets_per_night: tickets, order, turns, projects } = body;
  if (typeof nightly !== 'boolean' || typeof start !== 'string') return null;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes)) return null;
  if (typeof tickets !== 'number' || !Number.isInteger(tickets)) return null;
  if (!Array.isArray(order) || !isTurnRule(turns) || !Array.isArray(projects)) return null;
  const list: BugHuntProject[] = [];
  for (const item of projects) {
    if (!isRecord(item)) return null;
    const { name, path } = item;
    if (typeof name !== 'string' || typeof path !== 'string') return null;
    list.push({ name, path });
  }
  return { nightly, start, minutes, tickets, hunters: huntersOf(order), projects: list, turns };
}

/** The config as the change would leave it, for the picture drawn before the answer comes back. */
function withChange(config: BugHuntsConfig, change: BugHuntsChange): BugHuntsConfig {
  const named = change.projects ?? [];
  const rank = (name: string) => (named.includes(name) ? named.indexOf(name) : named.length);
  return {
    ...config,
    nightly: change.nightly ?? config.nightly, start: change.start ?? config.start,
    minutes: change.minutes ?? config.minutes, tickets: change.ticketsPerNight ?? config.tickets,
    hunters: change.order === undefined ? config.hunters : huntersOf(change.order),
    projects: change.projects === undefined ? config.projects : [...config.projects].sort((a, b) => rank(a.name) - rank(b.name)),
    turns: isTurnRule(change.turns) ? change.turns : config.turns,
  };
}

/** A copy of the list with the item moved one place by `by`, or `null` when it is absent or has no neighbour that way. */
function swapped<T>(list: readonly T[], item: T, by: -1 | 1): T[] | null {
  const at = list.indexOf(item);
  const to = at + by;
  if (at === -1 || to < 0 || to >= list.length) return null;
  const copy = [...list];
  copy.splice(at, 1); copy.splice(to, 0, item);
  return copy;
}

/** A typed field's saved value as the text its input shows when no draft is open. */
const SAVED_TEXT: Record<BugHuntersTypedField, (config: BugHuntsConfig) => string> = {
  start: (c) => c.start, minutes: (c) => String(c.minutes), tickets: (c) => String(c.tickets),
};

/** The change a typed field's text makes: a number goes unjudged, the dispatcher's answer is the judge. */
const CHANGE_OF: Record<BugHuntersTypedField, (text: string) => BugHuntsChange> = {
  start: (text) => ({ start: text }),
  minutes: (text) => ({ minutes: Number(text) }),
  tickets: (text) => ({ ticketsPerNight: Number(text) }),
};

/** A copy of the record without the key, or the record itself when the key is absent, so React skips the render. */
function without<K extends string>(held: Partial<Record<K, string>>, key: K): Partial<Record<K, string>> {
  if (!(key in held)) return held;
  const copy: Partial<Record<K, string>> = { ...held };
  delete copy[key];
  return copy;
}

/**
 * The bug hunters' settings, `~/.claude/charters/hunts.toml`: whether a night starts by itself and when, how long it runs, how many
 * tickets a hunter may file, which hunters take turns and in what order, the order of the projects, and how the turns are taken.
 *
 * Used by `RunnerBugHuntersRow`, which draws everything this answers and calls every act it hands back.
 *
 * THE DISPATCHER IS THE ONE JUDGE OF A VALUE. A change is sent as it was made and the answer is drawn: a value the dispatcher refuses
 * snaps back to the saved one and its reason is kept in `refusals` under that setting's name, without the command's lead.
 *
 * ONE FILE, SO ONE ORDER OF ANSWERS — every write waits for the one before it, retires the reads asked before it, and only the last
 * write's answer is drawn; the switch, the turn rule and the two orders are drawn as picked at once and corrected by the answer, while
 * a typed field keeps its draft until its answer lands.
 */
export function useBugHunters(): BugHunters {
  const [config, setConfig] = useState<BugHuntsConfig | null>(null);
  const configRef = useRef<BugHuntsConfig | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const [drafts, setDrafts] = useState<Partial<Record<BugHuntersTypedField, string>>>({});
  const draftsRef = useRef<Partial<Record<BugHuntersTypedField, string>>>({});
  const [refusals, setRefusals] = useState<Partial<Record<BugHuntersField, string>>>({});
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const writes = useRef(0);
  const generation = useRef(0);
  const hold = useCallback((next: BugHuntsConfig | null) => { configRef.current = next; setConfig(next); }, []);

  // A write's own answer is coming and is newer than any read started now.
  const refresh = useCallback(async () => {
    if (writes.current > 0) return;
    const asked = generation.current;
    const answer = await readHuntsSettings();
    if (generation.current !== asked || writes.current > 0) return;
    const truth = answer.ok ? configOf(answer.body) : null;
    setUnreadable(truth === null);
    if (truth !== null) hold(truth);
  }, [hold]);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    // The operator sets these from his phone too; iOS Safari fires no reliable focus on an app switch.
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);

  const write = useCallback((field: BugHuntersField, change: BugHuntsChange, optimistic: boolean): Promise<boolean> => {
    setRefusals((held) => without(held, field));
    if (optimistic && configRef.current !== null) { hold(withChange(configRef.current, change)); setUnreadable(false); }
    writes.current += 1; generation.current += 1; setInFlight((n) => n + 1);
    const sent = queue.current.then(async () => {
      const answer = await writeHuntsSettings(change);
      const settled = answer.ok ? configOf(answer.body) : null;
      if (settled !== null) {
        setRefusals((held) => without(held, field));
        // Only the last write's answer paints the rows: a newer change may already be drawn.
        if (writes.current === 1) { hold(settled); setUnreadable(false); }
        // A typed field's draft drops once this resolves: what the file took must be drawn now, not when the later answer lands.
        else if (!optimistic && configRef.current !== null) hold(withChange(configRef.current, change));
        return true;
      }
      const reason = answer.ok ? 'The dispatcher did not answer with the hunt settings.' : answer.sentence;
      setRefusals((held) => ({ ...held, [field]: reason }));
      const again = await readHuntsSettings();
      if (writes.current === 1) {
        const truth = again.ok ? configOf(again.body) : null;
        setUnreadable(truth === null);
        hold(truth);
      }
      return false;
    }).finally(() => { writes.current -= 1; generation.current += 1; setInFlight((n) => n - 1); });
    queue.current = sent;
    return sent;
  }, [hold]);

  const setNightly = useCallback(async (next: boolean) => { await write('nightly', { nightly: next }, true); }, [write]);
  const setTurns = useCallback(async (next: BugHunterTurnRule) => { await write('turns', { turns: next }, true); }, [write]);
  const turnOrder = useCallback((): BugHunterKind[] => (configRef.current?.hunters ?? []).filter((h) => h.takesTurn).map((h) => h.kind), []);
  const setHunterTurn = useCallback(async (kind: BugHunterKind, takesTurn: boolean) => {
    const order = turnOrder();
    if (configRef.current === null || order.includes(kind) === takesTurn) return;
    await write('hunters', { order: takesTurn ? [...order, kind] : order.filter((k) => k !== kind) }, true);
  }, [turnOrder, write]);
  const moveHunter = useCallback(async (kind: BugHunterKind, by: -1 | 1) => {
    const next = swapped(turnOrder(), kind, by);
    if (next !== null) await write('hunters', { order: next }, true);
  }, [turnOrder, write]);
  const reorderHunters = useCallback((order: readonly string[]) => write('hunters', { order: [...order] }, true), [write]);
  const moveProject = useCallback(async (name: string, by: -1 | 1) => {
    const next = swapped((configRef.current?.projects ?? []).map((p) => p.name), name, by);
    if (next !== null) await write('projects', { projects: next }, true);
  }, [write]);
  const reorderProjects = useCallback((order: readonly string[]) => write('projects', { projects: [...order] }, true), [write]);

  const typeField = useCallback((field: BugHuntersTypedField, text: string) => {
    draftsRef.current = { ...draftsRef.current, [field]: text };
    setDrafts(draftsRef.current);
    setRefusals((held) => without(held, field));
  }, []);
  const dropDraft = useCallback((field: BugHuntersTypedField, text: string) => {
    if (draftsRef.current[field] !== text) return;
    draftsRef.current = without(draftsRef.current, field);
    setDrafts(draftsRef.current);
  }, []);
  const leaveField = useCallback((field: BugHuntersTypedField) => {
    const text = draftsRef.current[field];
    if (text === undefined) return;
    const saved = configRef.current;
    // A blank draft, or one that matches the saved value, writes nothing: the dispatcher is not run for it.
    if (text.trim() === '' || (saved !== null && text === SAVED_TEXT[field](saved))) return dropDraft(field, text);
    void write(field, CHANGE_OF[field](text), false).then(() => dropDraft(field, text));
  }, [dropDraft, write]);

  const texts: Record<BugHuntersTypedField, string> = config === null ? { start: '', minutes: '', tickets: '' } : {
    start: drafts.start ?? SAVED_TEXT.start(config),
    minutes: drafts.minutes ?? SAVED_TEXT.minutes(config),
    tickets: drafts.tickets ?? SAVED_TEXT.tickets(config),
  };
  return {
    config, unreadable, saving: inFlight > 0, texts, refusals, setNightly, typeField, leaveField,
    setHunterTurn, moveHunter, reorderHunters, moveProject, reorderProjects, setTurns, refresh,
  };
}
