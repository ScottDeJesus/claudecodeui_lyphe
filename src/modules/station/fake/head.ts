import { createElement } from 'react';
import type { ComponentProps } from 'react';

import { CompanionAvatar, CompanionControls } from '@/modules/companion';
import { HER_PICTURES, KANBAN, picture, TREE_POLISH, UPLOADS } from '@/modules/station/fake/conversation';
import { StationHeadView } from '@/modules/station/StationHead';
import type { CompanionPicture } from '@/shared/companion-types';
import type { CompanionPresence, CompanionPresenceState } from '@/shared/types';

/*
 * HER HEAD'S FIXTURES, for `station-fake.ts`'s pictures only: `StationHeadView` drawn from her picture in each of the station's
 * four (`fake/conversation.ts`'s `HER_PICTURES`), her face the companion's own drawing (`CompanionAvatar`, through its barrel)
 * on the picture's presence, her controls the companion's own (`CompanionControls`, `line`) on presses that do nothing. Nothing
 * in the app imports this file.
 *
 * A fixture cannot mount her bound face (`CompanionFace` reads the live provider), so the face is drawn on the presence the
 * picture resolves to, with no face id: her initial, the look of a box whose face is not made yet. The shots probe lays the
 * account's own face id over it (`GET /api/companion`), so the photographs carry her portrait.
 *
 * - `home`: Idle; `waiting`: Speaking (her read-back, marked in the conversation); `walkthrough`: Walking Kanban lane review ·
 *   item 4 of 15, her turn running (Stop in the line); `empty`: Asleep · your next message wakes her.
 *
 * `HEAD_STATES` are her fourteen presences, one drawing each by the presence's own word, drawn by the probe over `home` in the
 * slot's place: the page's own four (listening, transcribing, speaking, cut), her process's four (loading, failed with its
 * banner, asleep, waking) and her activity's six (idle, thinking, reading a chat, reading code, drafting, walking), each on the
 * picture it comes from: a turn running wherever she works, so Stop stands in the line.
 */

/** A press a picture never makes: the shots photograph, they do not press. */
const NO_PRESS = () => {};
/** A save a picture never sends. */
const NO_SAVE = () => Promise.resolve();
/** This page's voice switch, on: "Voice on this device" in the line. */
const VOICE_ON = { on: true, setOn: NO_PRESS };

/** The sentence her harness says when her process could not start (`companion-fake.ts`'s, the panel's own failed state). */
const FAILED_SENTENCE = 'Kaylee couldn\'t start: the Claude login on this box has expired. Sign in again from Settings > Account.';

/** A presence: its word, and what it concerns. */
const presenceOf = (state: CompanionPresenceState, about: Partial<Omit<CompanionPresence, 'state'>> = {}): CompanionPresence => (
  { state, session: null, files: null, walk: null, ...about });

/** Her head drawn from `her` (null: no picture yet) at `presence`. */
function drawing(her: CompanionPicture | null, presence: CompanionPresence) {
  const name = her?.settings.name ?? 'Kaylee';
  return {
    view: StationHeadView,
    props: {
      name,
      presence,
      face: (px: number) => createElement(CompanionAvatar, {
        presence, faceId: her?.face.id ?? null, voice: null, sentences: null, look: null, name, size: px,
      }),
      controls: (align: 'start' | 'center') => createElement(CompanionControls, {
        name, picture: her, presence, voice: VOICE_ON, layout: 'line', align,
        onModelChange: NO_SAVE, onLiveChange: NO_SAVE, onInterrupt: NO_SAVE, onClear: NO_SAVE,
      }),
      failure: her?.process.state === 'failed' ? { sentence: her.process.error } : null,
    } satisfies Omit<ComponentProps<typeof StationHeadView>, 'tier'>,
  };
}

/** Her head in each of the four pictures. */
export const HEAD_FAKE = {
  home: drawing(HER_PICTURES.home, presenceOf('idle')),
  waiting: drawing(HER_PICTURES.waiting, presenceOf('speaking')),
  walkthrough: drawing(HER_PICTURES.walkthrough, presenceOf('walking', { session: KANBAN, walk: { at: 4, total: 15 } })),
  empty: drawing(HER_PICTURES.empty, presenceOf('asleep')),
};

/** `home`'s picture with her turn running on `activity`'s phase: Stop stands in the line. */
const working = (phase: CompanionPicture['activity']['phase'], about: Partial<Omit<CompanionPresence, 'state'>> = {}) => picture({
  ...HER_PICTURES.home, turnId: 'h4', activity: { session: null, files: null, walk: null, ...about, phase },
});

/** Her fourteen presences, by their own words, each on the picture it comes from. */
export const HEAD_STATES: Record<CompanionPresenceState, ReturnType<typeof drawing>> = {
  idle: drawing(HER_PICTURES.home, presenceOf('idle')),
  listening: drawing(HER_PICTURES.home, presenceOf('listening')),
  transcribing: drawing(HER_PICTURES.home, presenceOf('transcribing')),
  thinking: drawing(working('thinking'), presenceOf('thinking')),
  speaking: drawing(HER_PICTURES.waiting, presenceOf('speaking')),
  reading_session: drawing(working('reading_session', { session: TREE_POLISH }), presenceOf('reading_session', { session: TREE_POLISH })),
  reading_code: drawing(
    working('reading_code', { files: ['src/modules/station/StationShell.tsx', 'src/modules/station/stationRegions.ts'] }),
    presenceOf('reading_code', { files: ['src/modules/station/StationShell.tsx', 'src/modules/station/stationRegions.ts'] }),
  ),
  drafting: drawing(working('drafting', { session: UPLOADS }), presenceOf('drafting', { session: UPLOADS })),
  walking: drawing(HER_PICTURES.walkthrough, presenceOf('walking', { session: KANBAN, walk: { at: 4, total: 15 } })),
  cut: drawing(HER_PICTURES.home, presenceOf('cut')),
  loading: drawing(null, presenceOf('loading')),
  failed: drawing(picture({ ...HER_PICTURES.home, process: { state: 'failed', error: FAILED_SENTENCE } }), presenceOf('failed')),
  asleep: drawing(HER_PICTURES.empty, presenceOf('asleep')),
  waking: drawing(picture({ ...HER_PICTURES.empty, process: { state: 'waking', error: null } }), presenceOf('waking')),
};
