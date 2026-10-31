import { useTranslation } from 'react-i18next';

import '@/modules/companion/CompanionAvatar.css';
import { CompanionPortrait } from '@/modules/companion/CompanionPortrait';
import { useFaceAtlas } from '@/modules/companion/hooks/useFaceAtlas';
import { presenceWords } from '@/modules/companion/utils/presenceWords';
import type { CompanionFaceLook, CompanionFaceSentences, CompanionFaceVoice, CompanionPresence } from '@/shared/types';
import { Avatar } from '@/shared/ui';

type CompanionAvatarProps = {
  /** What she is doing: the portrait takes her face from `state`, the marks their accents from it and the walk ring from `walk`; the chat and files give the accessible name its subject. */
  presence: CompanionPresence;
  /** The face to draw: her `picture.face.id`. Null on a box with no face made yet, where the disc draws her initial instead. */
  faceId: string | null;
  /**
   * The page's voice, read by the portrait's loop while she speaks (`level()` for how far her mouth opens, `progress()` for the vowel it
   * shapes): functions, never props that change, so a level sixty times a second redraws nothing in React. Null where no voice sounds.
   */
  voice: CompanionFaceVoice | null;
  /** The sentences she says, for her mood and her vowels; null where there are none (Settings' preview, an idle fixture). */
  sentences: CompanionFaceSentences | null;
  /** Where the anchor she looks at lies from her; null when no look holds. Her head turns toward it. */
  look: CompanionFaceLook | null;
  /** Her name as he set it; the default stands in while a page has not read it. */
  name?: string;
  /** The square she fills, in pixels, read only by her initial's `Avatar` (a box with no face yet). The portrait and the marks fill their square by CSS, so they follow the disc's own size frame by frame. */
  size: number;
};

/** The sentences of a face with none to read: it keeps its own faces, blinks and glances, and says nothing. */
const NO_SENTENCES: CompanionFaceSentences = { playing: null, newest: null, turnRunning: false };

/** The walk ring's radius in the 100-unit square: it runs near the disc's edge, inside the square's, whose stroke the stylesheet sets. */
const RING_RADIUS = 45;

/**
 * Kaylee's face, "the light that guides this project": her portrait, the one photographed face the bake made and the page plays
 * from memory (`CompanionPortrait`), with her marks drawn over it in code (SVG and CSS on Verve's tokens), so the marks follow the
 * theme and scale without blur. Used by this module's CompanionFace (the provider-bound face that the button's floating disc
 * and the station's head draw), by Settings' face card, and by the station module's fixtures, which draw her on fixture
 * presences; the face fills the square it is given and owns no chrome.
 *
 * LAYERS, bottom to top: the disc's own ground (the button's, which shows until the sheets are decoded and then gives way to her
 * face fading in); the portrait; the marks. A box with no face made yet (`faceId` null) draws her initial in the kit's `Avatar`
 * where the portrait would be.
 *
 * ONE SVG OF MARKS, KEYED BY `data-state`. Each state turns on its own accent (her ears pulsing, three dots turning, a page, a
 * pencil, the walk ring); the portrait draws the state's face, and the stylesheet beside this file holds every accent and every keyframe.
 * A state's LOOK is its still frame and its MOVEMENT is added only under `prefers-reduced-motion: no-preference`, so reduced motion
 * keeps each look and drops the movement.
 *
 * WHICH STATE DRAWS WHICH LOOK. `data-state` carries the presence state as it is, fourteen words. Ten have an accent or a face of
 * their own (idle, listening, transcribing, thinking, speaking, reading_session, reading_code, drafting, walking, cut) and `failed`
 * is the eleventh: she is still, her stopped face with the status line's amber, `--warn-dot`, as a ring round it. The other three
 * share a look: `asleep` and `loading` draw idle's, and `waking` draws thinking's (a word is on its way).
 *
 * She walks a result on a ring at `walk.at / walk.total` whose numbers show while the face is hovered or its button focused.
 *
 * Her accessible name is her name and the state in words ("Kaylee, reading Bugfixes"), which a button around her may replace
 * with a label of its own. The portrait is for the eye alone: the marks' svg carries the name.
 */
export function CompanionAvatar({ presence, faceId, voice, sentences, look, name, size }: CompanionAvatarProps) {
  const { t } = useTranslation();
  const her = name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });
  const { state, walk } = presence;
  const atlas = useFaceAtlas(faceId);
  const count = walk ? `${walk.at}/${walk.total}` : '';
  // The numbers shrink a little and their pill widens with the digits ("12/40"), so it stays inside the head's width. They
  // stop shrinking at 12 units (a walk of a thousand items), and the digits of a longer walk are squeezed to fit the pill.
  const countSize = Math.max(12, 22 - Math.max(0, count.length - 3) * 3);
  const countNatural = count.length * countSize * 0.64;
  const countWidth = Math.min(68, countNatural + 14);
  const countSqueezed = countNatural + 14 > countWidth;
  // A walk with no items has nowhere to fill: the track alone. At 0 of n ("set up, not begun") the arc is empty too.
  const filled = walk && walk.total > 0 ? Math.min(1, Math.max(0, walk.at / walk.total)) : 0;

  return (
    <div className="kaylee-avatar">
      {atlas !== null && <CompanionPortrait atlas={atlas} presence={state} voice={voice} sentences={sentences ?? NO_SENTENCES} look={look} />}
      {faceId === null && (
        // Decorative: the marks' svg beside it carries her name.
        <span aria-hidden="true" className="contents">
          <Avatar initials={Array.from(her)[0]?.toUpperCase() ?? ''} size={size} />
        </span>
      )}
      <svg className="kaylee" data-state={state} viewBox="0 0 100 100" role="img" aria-label={presenceWords(t, her, presence)}>
        {/* Listening: sound arriving at her ears, a pair of arcs a side, pulsing in toward her. */}
        <g className="kaylee__ears">
          <path className="kaylee__ear kaylee__ear--near" d="M 11 39 Q 7 50 11 61" />
          <path className="kaylee__ear kaylee__ear--far" d="M 6 33 Q 1 50 6 67" />
          <path className="kaylee__ear kaylee__ear--near kaylee__ear--right" d="M 89 39 Q 93 50 89 61" />
          <path className="kaylee__ear kaylee__ear--far kaylee__ear--right" d="M 94 33 Q 99 50 94 67" />
        </g>

        {/* Transcribing and thinking: three dots turning around her, each smaller than the one before it. */}
        <g className="kaylee__dots">
          <circle className="kaylee__dot" cx="50" cy="6" r="6.4" />
          <circle className="kaylee__dot" cx="88.1" cy="72" r="5" />
          <circle className="kaylee__dot" cx="11.9" cy="72" r="3.8" />
        </g>

        {/* Reading a chat: a speech bubble held at her side. */}
        <g className="kaylee__bubble">
          <path className="kaylee__paper" d="M 63 60 H 86 a 4 4 0 0 1 4 4 V 78 a 4 4 0 0 1 -4 4 H 77 L 70 90 V 82 H 63 a 4 4 0 0 1 -4 -4 V 64 a 4 4 0 0 1 4 -4 Z" />
          <path className="kaylee__line" d="M 64 67.5 H 85" />
          <path className="kaylee__line" d="M 64 74 H 78" />
        </g>

        {/* Reading code: a small page, its lines indented like code, held where her eyes can sweep across it. */}
        <g className="kaylee__page">
          <rect className="kaylee__paper" x="60" y="56" width="29" height="34" rx="4" />
          <path className="kaylee__line kaylee__line--a" d="M 65 64 H 78" />
          <path className="kaylee__line kaylee__line--b" d="M 69 70 H 83" />
          <path className="kaylee__line kaylee__line--c" d="M 69 76 H 76" />
          <path className="kaylee__line kaylee__line--a" d="M 65 82 H 80" />
        </g>

        {/* Drafting: a pencil writing a stroke; the stroke is drawn from its left end and the pencil rides its tip. */}
        <g className="kaylee__draft">
          <path className="kaylee__stroke" d="M 36 92 q 5 -6 10 0 t 10 0 t 10 0" pathLength="1" />
          <g className="kaylee__pencil">
            <path className="kaylee__pencil-body" d="M 0 0 L 5 -4.2 L 25 -24.5 L 30 -19.8 L 9.6 0.6 Z" />
            <path className="kaylee__pencil-tip" d="M 0 0 L 5 -4.2 L 9.6 0.6 Z" />
            <path className="kaylee__pencil-end" d="M 25 -24.5 L 27.4 -27 L 32.4 -22.2 L 30 -19.8 Z" />
          </g>
        </g>

        {/* Walking a result: a ring around her face, filled to item k of n. */}
        <g className="kaylee__walk">
          <circle className="kaylee__track" cx="50" cy="50" r={RING_RADIUS} />
          {filled > 0 && (
            <circle
              className="kaylee__progress"
              cx="50"
              cy="50"
              r={RING_RADIUS}
              pathLength="1"
              strokeDasharray={`${filled} 1`}
            />
          )}
          {walk && (
            <g className="kaylee__count">
              <rect x={50 - countWidth / 2} y="56" width={countWidth} height="30" rx="15" />
              <text
                x="50"
                y="71.5"
                textAnchor="middle"
                dominantBaseline="central"
                style={{ fontSize: countSize }}
                textLength={countSqueezed ? countWidth - 14 : undefined}
                lengthAdjust={countSqueezed ? 'spacingAndGlyphs' : undefined}
              >
                {count}
              </text>
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}
