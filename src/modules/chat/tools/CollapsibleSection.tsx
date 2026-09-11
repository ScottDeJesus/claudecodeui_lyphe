import React, { useState } from 'react';

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import { TOOL_ROW_HEADER, TOOL_ROW_LABEL, TOOL_ROW_SEPARATOR } from '@/modules/chat/tools/toolRow';

type CollapsibleSectionProps = {
  title: string;
  toolName?: string;
  open?: boolean;
  action?: React.ReactNode;
  badge?: React.ReactNode;
  /** The tool's mark, drawn before the label. */
  icon?: React.ReactNode;
  /** Facts that read with the tool's name — an edit's `+12 -3` — drawn right after it. */
  meta?: React.ReactNode;
  onTitleClick?: () => void;
  children: React.ReactNode;
  className?: string;
  /** Sits inside the shared tool-row frame: the header takes the row's size and padding. */
  framed?: boolean;
};

/**
 * Reusable collapsible section with consistent styling: icon, label, meta, `/`,
 * title, then the badge rightmost. The whole header is the toggle.
 *
 * Used by chat's CollapsibleDisplay so every expandable tool block shares one
 * header and border treatment.
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  toolName,
  open = false,
  action,
  badge,
  icon,
  meta,
  onTitleClick,
  children,
  className = '',
  framed = false,
}) => {
  // A document has nothing to click, so a section that stays collapsed in
  // an export is simply content the reader can never reach.
  const isExporting = useIsExportingTranscript();
  // Held here rather than inside Collapsible so the whole header can toggle it: an
  // Edit header also carries the filename button, and a button cannot sit in a button.
  const [isOpen, setIsOpen] = useState(open);
  const toggle = () => setIsOpen((previous) => !previous);
  // Framed, the header is the row line every tool row shares; unframed (a result
  // continuing its call), it stays a slim line. Either way it sticks while open.
  const header = framed
    ? cn(TOOL_ROW_HEADER, 'group-data-[state=open]/section:sticky group-data-[state=open]/section:top-0 group-data-[state=open]/section:z-10 group-data-[state=open]/section:bg-muted')
    : 'flex items-center gap-1.5 py-0.5 text-xs group-data-[state=open]/section:sticky group-data-[state=open]/section:top-0 group-data-[state=open]/section:z-10 group-data-[state=open]/section:-mx-1 group-data-[state=open]/section:bg-background group-data-[state=open]/section:px-1';

  const lead = (
    <>
      {icon}
      {toolName && <span className={TOOL_ROW_LABEL}>{toolName}</span>}
      {meta && <span className="flex flex-shrink-0 items-center">{meta}</span>}
      {toolName && <span className={TOOL_ROW_SEPARATOR}>/</span>}
    </>
  );
  // The badge (the outcome) is always the row's rightmost mark.
  const trailing = (
    <>
      {action && <span className="ml-auto flex flex-shrink-0 items-center pl-2">{action}</span>}
      {badge && <span className={cn('flex flex-shrink-0 items-center', action ? 'ml-2' : 'ml-auto pl-2')}>{badge}</span>}
    </>
  );

  return (
    <Collapsible open={isOpen || isExporting} onOpenChange={setIsOpen} className={cn('group/section', className)}>
      {onTitleClick ? (
        <div
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              toggle();
            }
          }}
          className={cn(header, 'cursor-pointer select-none outline-none focus-visible:ring-1 focus-visible:ring-ring')}
        >
          {lead}
          {/* The filename opens the file; the rest of the header toggles the section. */}
          <button
            onClick={(event) => {
              event.stopPropagation();
              onTitleClick();
            }}
            onKeyDown={(event) => event.stopPropagation()}
            className="min-w-0 truncate text-left font-mono text-primary transition-colors hover:text-primary/80 hover:underline"
          >
            {title}
          </button>
          {trailing}
        </div>
      ) : (
        <CollapsibleTrigger className={cn(header, 'w-full select-none text-muted-foreground transition-colors hover:text-foreground')}>
          {lead}
          <span className="min-w-0 flex-1 truncate text-left">{title}</span>
          {trailing}
        </CollapsibleTrigger>
      )}

      <CollapsibleContent>
        <div className={framed ? 'pb-2 pl-7 pr-2.5' : 'mt-1.5 pl-[18px]'}>
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
