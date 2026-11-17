import '@/modules/chat/composer/chatLine.css';

import { useTranslation } from 'react-i18next';

import { useCoreDrawing } from '@/shared/context/CoreDrawingContext';
import type { CoreDrawingInput } from '@/shared/context/CoreDrawingContext';
import type { CompanionMaterial } from '@/shared/types';
import { SignalLoop } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The side of the square the chat's core is drawn in, in px: the size of the companion's own core docked on the sessions home. */
const CORE_PX = 56;

/** The ring that reads the context, in the core's own box: its radius and how thick it is drawn. */
const RING_RADIUS = 31;
const RING_WIDTH = 1.5;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** From this share of the context window the ring takes the warn ink: the window is nearly full. */
const CONTEXT_WARN = 0.8;

/** What the chat is doing, as its core draws it. */
export type ChatCoreState = 'idle' | 'working' | 'waiting';

/** The core's own forms for the three: at rest, the loop turning while a turn runs, and drawn in (listening) while it waits on the reader. */
const FORM: Record<ChatCoreState, CoreDrawingInput['state']> = { idle: 'idle', working: 'thinking', waiting: 'listening' };

/**
 * The material a model is drawn in, by the family its name carries: Opus is Tube, Haiku is Wire, and every other model is Mercury. A fourth
 * material for Sonnet is the design system's (Plasma) and is not in this app's instrument yet, so Sonnet reads as Mercury until it is.
 */
function materialOf(model: string): CompanionMaterial {
  const name = model.toLowerCase();
  if (name.includes('opus')) return 'tube';
  if (name.includes('haiku')) return 'wire';
  return 'mercury';
}

type ChatCoreProps = {
  /** The model the chat runs on, by id or label: the core is made of it. */
  model: string;
  /** The model's name as the reader knows it ("Opus 5.5"), for the core's spoken name; the id stands in while the catalog loads. */
  modelLabel: string;
  /** What the chat is doing. */
  state: ChatCoreState;
  /** How full the context window is, 0 to 1, or null while it is not known: the hairline round the core. */
  context: number | null;
  /** Whether the chat's settings stand open under the core's press. */
  open: boolean;
  /** The id of the row the press opens, for `aria-controls`. */
  controls: string;
  /** The core, pressed: the chat's settings open or close. */
  onToggle: () => void;
  className?: string;
};

/**
 * THE CHAT'S OWN CORE, beside the line the reader types in: the same instrument the companion is drawn with, one for each chat. The drawing
 * is the page's to give (`useCoreDrawing`): the instrument is the companion module's, which the chat cannot import without a cycle.
 * It says three things without a word. WHAT IT IS MADE OF is the model the chat runs on (`materialOf`). ITS FORM is what the chat is doing: at
 * rest, the loop turning while a turn runs, drawn in while it waits on the reader. THE HAIRLINE ROUND IT is how full the context window is, in the
 * warn ink once it is nearly full.
 *
 * IT IS A PRESS: the chat's settings (the model and effort, how edits happen, the tool sets, the count of tokens, the commands, export) open in a
 * row over the line and close again. They are the composer's own controls, unchanged; the core is where they are kept.
 *
 * WHERE IT STANDS is the stylesheet's (`chatLine.css`): in the margin beside the line where the chat's column has one, so the line and the talk
 * above it keep one left edge, and at the line's start where it has none. Either way it stays level with the line's middle as the line grows.
 *
 * `data-chat-core` reads the state. Used by `ChatComposer`.
 */
export function ChatCore({ model, modelLabel, state, context, open, controls, onToggle, className }: ChatCoreProps) {
  const { t } = useTranslation('chat');
  const draw = useCoreDrawing();
  const label = t('core.settings', { defaultValue: 'Chat settings · {{model}}', model: modelLabel });
  const filled = context === null ? 0 : Math.min(1, Math.max(0, context));

  return (
    <button
      type="button"
      data-chat-core={state}
      aria-label={label}
      title={label}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        // Its position is the stylesheet's (`chatLine.css`): in the line's row, or in the strip beside it.
        'chat-line__core grid flex-none place-items-center rounded-full outline-none transition-transform hover:scale-[1.04] focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background',
        className,
      )}
      style={{ width: CORE_PX, height: CORE_PX }}
    >
      {/* The core's own accessible name is the companion's; here the button speaks for it. */}
      <span aria-hidden="true" className="pointer-events-none grid size-full place-items-center">
        {draw !== null
          ? draw({ material: materialOf(model), state: FORM[state], size: CORE_PX })
          // No page gave the instrument (a surface that mounts the chat alone): the app's small loop stands in.
          : <SignalLoop state={state === 'working' ? 'thinking' : 'idle'} size={28} />}
      </span>
      {context !== null && (
        <svg
          aria-hidden="true"
          data-chat-core-context={Math.round(filled * 100)}
          data-tone={filled >= CONTEXT_WARN ? 'warn' : undefined}
          viewBox="-34 -34 68 68"
          className="pointer-events-none absolute -inset-1.5 -rotate-90"
        >
          <circle r={RING_RADIUS} fill="none" strokeWidth={RING_WIDTH} style={{ stroke: 'var(--border)' }} />
          <circle
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_WIDTH}
            strokeLinecap="butt"
            strokeDasharray={`${filled * RING_LENGTH} ${RING_LENGTH}`}
            style={{ stroke: filled >= CONTEXT_WARN ? 'var(--warn-ink)' : 'var(--ink-muted)' }}
            className="transition-[stroke-dasharray] duration-500 motion-reduce:transition-none"
          />
        </svg>
      )}
    </button>
  );
}
