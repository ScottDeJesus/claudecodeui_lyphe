import { Card, CardContent } from '@/shared/ui';

/**
 * What the chat shows where a widget was asked for and cannot be drawn.
 *
 * It is a CARD WITH TWO SENTENCES and deliberately not an `EmptyState`: an empty state offers an
 * action, and there is no action a reader can take from inside a transcript. The fence body was
 * written by a model on a turn that has already ended; the reader cannot fix the ids, cannot
 * reach the DocSpace host and cannot retry. So the card's whole job is to say that something was
 * meant to be here and why it is not — which is strictly more than the alternatives on offer.
 * Rendering nothing leaves a silent hole the reader reads as a bug in the chat; falling back to
 * the raw body paints a block of JSON with no hint of what it was for.
 *
 * The tone is WARN and never DANGER. Nothing was denied and nothing was destroyed — an
 * unreachable block or a malformed reference is a disappointment, not a refusal — and red is
 * reserved for destructive and denied (design doctrine). It travels as `data-tone`, so the
 * amber comes from the one `[data-tone]` block in `tokens.css` rather than from anything spelled
 * here. The marker attribute on the root is what the phase-28 probe selects on, so it is part of
 * the contract rather than a debugging leftover.
 *
 * Every string reaches the DOM as a text node. `reason` is composed from a fence body and a host
 * name — both ultimately model or operator input — so it never becomes markup.
 */
export function WidgetErrorCard({ reason }: { reason: string }) {
  return (
    <Card className="my-3" data-widget-error data-tone="warn">
      <CardContent className="pt-4">
        <p className="text-sm font-medium text-warn-ink">{"This widget can't be shown"}</p>
        <p className="mt-1 text-sm text-muted-foreground">{reason}</p>
      </CardContent>
    </Card>
  );
}
