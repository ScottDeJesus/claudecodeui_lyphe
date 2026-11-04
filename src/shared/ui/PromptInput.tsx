import * as React from 'react';
import { SendHorizonalIcon, SquareIcon } from 'lucide-react';

import { cn } from '@/shared/utils';
import { Button } from '@/shared/ui/Button';
import { Tooltip } from '@/shared/ui/Tooltip';

/* ─── Context ────────────────────────────────────────────────────── */

type PromptInputStatus = 'ready' | 'submitted' | 'streaming' | 'error';

type PromptInputContextValue = {
  status: PromptInputStatus;
};

const PromptInputContext = React.createContext<PromptInputContextValue | null>(null);

/** Read by PromptInputSubmit, which is only ever rendered inside PromptInput. */
const usePromptInput = () => {
  const context = React.useContext(PromptInputContext);
  if (!context) {
    throw new Error('PromptInput components must be used within PromptInput');
  }
  return context;
};

/* ─── PromptInput (root form) ────────────────────────────────────── */

export type PromptInputProps = {
  status?: PromptInputStatus;
} & React.FormHTMLAttributes<HTMLFormElement>;

/** Composer form shell, used by ChatComposer, the companion module's CompanionComposer and the kanban module's KanbanMetisConversation. */
export const PromptInput = React.forwardRef<HTMLFormElement, PromptInputProps>(
  ({ className, status = 'ready', children, ...props }, ref) => {
    const contextValue = React.useMemo(() => ({ status }), [status]);

    return (
      <PromptInputContext.Provider value={contextValue}>
        <form
          ref={ref}
          data-slot="prompt-input"
          className={cn(
            'relative overflow-hidden rounded-xl border border-border/50 bg-card/80 shadow-sm backdrop-blur-sm transition-all duration-200 focus-within:border-primary/30 focus-within:shadow-md focus-within:ring-1 focus-within:ring-primary/15',
            className
          )}
          {...props}
        >
          {children}
        </form>
      </PromptInputContext.Provider>
    );
  }
);
PromptInput.displayName = 'PromptInput';

/* ─── PromptInputHeader ──────────────────────────────────────────── */

/** Attachment/queue row above the composer textarea, used by ChatComposer. */
export const PromptInputHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="prompt-input-header"
    className={cn('px-3 pt-3', className)}
    {...props}
  />
));
PromptInputHeader.displayName = 'PromptInputHeader';

/* ─── PromptInputBody ────────────────────────────────────────────── */

/** Wrapper around the composer textarea, used by ChatComposer. */
export const PromptInputBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="prompt-input-body"
    className={cn('relative', className)}
    {...props}
  />
));
PromptInputBody.displayName = 'PromptInputBody';

/* ─── PromptInputTextarea ────────────────────────────────────────── */

/** Auto-growing message textarea, used by ChatComposer. */
export const PromptInputTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    data-slot="prompt-input-textarea"
    className={cn(
      'chat-input-placeholder block max-h-[40vh] w-full resize-none overflow-y-auto bg-transparent px-4 py-2 text-sm leading-6 text-foreground placeholder-muted-foreground/50 focus:outline-none sm:max-h-[300px]',
      className
    )}
    {...props}
  />
));
PromptInputTextarea.displayName = 'PromptInputTextarea';

/* ─── PromptInputFooter ──────────────────────────────────────────── */

/** Row below the composer textarea, used by ChatComposer. */
export const PromptInputFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="prompt-input-footer"
    className={cn('flex items-center justify-between border-t border-border/30 px-3 py-2', className)}
    {...props}
  />
));
PromptInputFooter.displayName = 'PromptInputFooter';

/* ─── PromptInputTools ───────────────────────────────────────────── */

/** Left-hand tool cluster in the composer footer, used by ChatComposer. */
export const PromptInputTools = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="prompt-input-tools"
    className={cn('flex items-center gap-1', className)}
    {...props}
  />
));
PromptInputTools.displayName = 'PromptInputTools';

/* ─── A press that keeps the field's focus ───────────────────────── */

/**
 * The `onMouseDown` of every press the composer draws (the kit's buttons below): the press never takes the focus from the field.
 * A tap on a touch screen ends in compatibility mouse events, and the `mousedown` is what moves the focus onto the pressed button.
 * On a phone that is the keyboard going down with the field's blur, and the page's keyboard readers re-lay the composer out as it
 * does (`useVisualViewportKeyboardOffset` ends its mark on a `focusout` into a button), so the tap's `click` can land where the
 * button no longer stands: the first tap dismissed the keyboard and sent nothing. A default-prevented `mousedown` leaves the focus
 * where it was, the keys stay up, nothing is re-laid and the `click` lands as pressed; typing goes on after the press. The caller's
 * own `onMouseDown` runs first. A press from the keyboard (Enter or Space on a focused button) has no `mousedown` and is untouched.
 *
 * Exported for the presses that stand beside the field without being the kit's own buttons, so none writes a second copy of the cure:
 * the companion module's talk buttons (the station's large one and the phone's round one), the chat module's attachment chips (the
 * remove control, in the chat's composer and Kaylee's) and the station module's draft dock (through its scope test, which decides
 * where the cure applies). `Target` is the element the handler is read on: a button by default, the dock's section there.
 */
export const keepFieldFocus = <Target extends HTMLElement = HTMLButtonElement>(
  own?: React.MouseEventHandler<Target>,
): React.MouseEventHandler<Target> => (event) => {
  own?.(event);
  event.preventDefault();
};

/**
 * The `onPointerDown` of the same presses, for the one state where `keepFieldFocus` never runs: a DISABLED button is dispatched no
 * `mousedown` (nor a `click`), so a tap on it still moved the focus onto nothing and dropped the keyboard: Send with nothing to
 * send, or the second tap of a double tap, which lands on the Send the first tap has just disabled. A `pointerdown` still reaches a
 * disabled button, and a default-prevented one leaves the focus where it was. Only while the button is disabled: an enabled press keeps
 * `keepFieldFocus` alone, so its `:active` look and its compatibility events are as they were. The caller's own `onPointerDown` runs first.
 *
 * Exported with `keepFieldFocus`, for the one caller that reads a press on its section and not on the button: the station module's draft
 * dock, whose card's Send is disabled while his brief is empty. `Target` is the element the handler is read on, as for `keepFieldFocus`.
 */
export const keepFieldFocusWhileDisabled = <Target extends HTMLElement = HTMLButtonElement>(
  disabled: boolean | undefined,
  own?: React.PointerEventHandler<Target>,
): React.PointerEventHandler<Target> => (event) => {
  own?.(event);
  if (disabled) event.preventDefault();
};

/* ─── PromptInputButton ──────────────────────────────────────────── */

export type PromptInputButtonTooltip = {
  content: React.ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
};

export type PromptInputButtonProps = {
  tooltip?: PromptInputButtonTooltip;
  /** The button's look: ghost, or tonal for a press that is lit (the companion's open mic). */
  variant?: 'ghost' | 'tonal';
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Icon button in the composer, used by ChatComposer, VoiceInputButton, and the companion module's CompanionComposer (attach) and
 * CompanionTalkButton (the talk button in the composer's cluster). It keeps the field's focus (`keepFieldFocus`), disabled or not.
 */
export const PromptInputButton = React.forwardRef<HTMLButtonElement, PromptInputButtonProps>(
  ({ className, tooltip, variant = 'ghost', children, onMouseDown, onPointerDown, ...props }, ref) => {
    const button = (
      <Button
        ref={ref}
        type="button"
        variant={variant}
        size="icon"
        className={cn('h-8 w-8 [&_svg]:size-4', className)}
        {...props}
        onMouseDown={keepFieldFocus(onMouseDown)}
        onPointerDown={keepFieldFocusWhileDisabled(props.disabled, onPointerDown)}
      >
        {children}
      </Button>
    );

    if (tooltip) {
      return (
        <Tooltip
          content={
            tooltip.shortcut ? (
              <span className="flex items-center gap-1.5">
                {tooltip.content}
                <kbd className="rounded bg-white/20 px-1 text-[10px]">{tooltip.shortcut}</kbd>
              </span>
            ) : (
              tooltip.content
            )
          }
          position={tooltip.side ?? 'top'}
        >
          {button}
        </Tooltip>
      );
    }

    return button;
  }
);
PromptInputButton.displayName = 'PromptInputButton';

/* ─── PromptInputSubmit ──────────────────────────────────────────── */

export type PromptInputSubmitProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Send/stop button of the composer, used by ChatComposer, the companion module's CompanionComposer and the kanban module's
 * KanbanMetisConversation. It keeps the field's focus (`keepFieldFocus`), disabled or not: one tap sends, and the field stays focused for
 * the next words, and a tap on a Send with nothing to send (or the one the last tap just disabled) leaves the keyboard up.
 */
export const PromptInputSubmit = React.forwardRef<HTMLButtonElement, PromptInputSubmitProps>(
  ({ className, children, onMouseDown, onPointerDown, ...props }, ref) => {
    // The status comes from the PromptInput root, which is the only place it is set.
    const { status } = usePromptInput();
    const isActive = status === 'submitted' || status === 'streaming';

    return (
      <Button
        ref={ref}
        type={isActive ? 'button' : 'submit'}
        variant="default"
        size="icon"
        className={cn('h-8 w-8 shrink-0 rounded-lg', className)}
        {...props}
        onMouseDown={keepFieldFocus(onMouseDown)}
        onPointerDown={keepFieldFocusWhileDisabled(props.disabled, onPointerDown)}
      >
        {children ?? (isActive ? (
          <SquareIcon className="h-3.5 w-3.5 fill-current" />
        ) : (
          <SendHorizonalIcon className="h-4 w-4" />
        ))}
      </Button>
    );
  }
);
PromptInputSubmit.displayName = 'PromptInputSubmit';

