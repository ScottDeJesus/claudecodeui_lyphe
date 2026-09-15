import { MinusIcon, type LucideIcon } from 'lucide-react';
import type { DragEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { GutterWidgetId } from '@/shared/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ScrollArea } from '@/shared/ui';

/**
 * One widget's chrome in its slot: a collapsed tab, or an open card, and the drag that moves it
 * between corners.
 *
 * THE FRAME KNOWS NOTHING OF RUNS OR MEMORIES. It is handed a title, a count, an icon and a body,
 * so a third widget costs the layout one entry and this file no change at all. The count is drawn
 * only when it is above zero — a badge reading zero is noise on a tab that already says what it is.
 *
 * THE DRAG IS NATIVE HTML5, and it starts from the whole frame: the collapsed tab IS the handle,
 * and the open card drags by its header. The widget id rides `dataTransfer` so a slot can tell
 * what is in flight, and `effectAllowed = 'move'` says the widget changes corner rather than being
 * copied into another one. The pointer never leaves the frame for a drag that begins and ends on
 * the same widget.
 *
 * Used by `src/modules/chat-gutters/ChatGutterLayout.tsx`, once per widget that has a corner.
 */
export function GutterWidgetFrame({
  widget,
  title,
  count,
  icon: Icon,
  open,
  onToggle,
  onDragStart,
  onDragEnd,
  children,
}: {
  widget: GutterWidgetId;
  title: string;
  count: number;
  icon: LucideIcon;
  open: boolean;
  onToggle: () => void;
  onDragStart: (widget: GutterWidgetId) => void;
  onDragEnd: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  const startDrag = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData('text/plain', widget);
    event.dataTransfer.effectAllowed = 'move';
    onDragStart(widget);
  };

  if (!open) {
    return (
      <div
        data-testid="gutter-widget"
        data-widget={widget}
        data-open="false"
        draggable
        onDragStart={startDrag}
        onDragEnd={onDragEnd}
      >
        <Button
          data-testid="gutter-widget-tab"
          variant="ghost"
          className="w-full justify-start gap-2 border border-border"
          onClick={onToggle}
          aria-expanded={false}
          aria-label={t('gutters.open', { name: title })}
          title={t('gutters.dragHint')}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          <span className="truncate">{title}</span>
          {count > 0 ? <Badge tone="info">{count}</Badge> : null}
        </Button>
      </div>
    );
  }

  return (
    <Card
      data-testid="gutter-widget"
      data-widget={widget}
      data-open="true"
      className="flex h-full min-h-0 flex-col"
    >
      <CardHeader
        data-testid="gutter-widget-header"
        draggable
        onDragStart={startDrag}
        onDragEnd={onDragEnd}
        title={t('gutters.dragHint')}
        className="flex cursor-grab flex-row items-center gap-2 p-3"
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        <CardTitle className="min-w-0 flex-1 truncate text-sm">{title}</CardTitle>
        {count > 0 ? <Badge tone="info">{count}</Badge> : null}
        <Button
          size="icon"
          variant="ghost"
          onClick={onToggle}
          aria-expanded={true}
          aria-label={t('gutters.collapse')}
        >
          <MinusIcon aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 p-0">
        <ScrollArea className="h-full">
          <div className="p-3">{children}</div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
