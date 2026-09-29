import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MarkdownPreview } from '@/modules/markdown-preview';
import type { ClaudeUpdateNote } from '@/shared/claude-update-types';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, FoldChevron } from '@/shared/ui';
import { useCollapsible } from '@/shared/ui/Collapsible';

/**
 * One package's changelog sections, newest first: a fold per version, the newest one already open.
 *
 * WHAT IS SHOWN AND WHY. Ten is what a person reads before deciding; the rest is behind one press
 * rather than in front of them. The count in that control is the number of sections the report
 * actually carries, so it stays honest when the server trims a changelog or a version has not been
 * documented yet — the `notesReason` line is where the server says so.
 *
 * THE BODY IS MARKDOWN, so it renders through the app's own `MarkdownPreview` in the same prose
 * measure the document viewer uses: a changelog section is written in list marks, inline code and
 * links, and every one of them has to arrive as itself.
 */

/** How many sections stand open before the "show all" press. */
const SHOWN_SECTIONS = 10;

/** The sign one section's fold wears, turned by that fold's own state rather than a second copy of it. */
function NoteChevron() {
  const { open } = useCollapsible();
  return <FoldChevron collapsed={!open} className="text-muted-foreground" />;
}

export function PatchNotes({
  notes,
  notesReason,
  changelogUrl,
}: {
  notes: ClaudeUpdateNote[];
  notesReason: string | null;
  changelogUrl: string;
}) {
  const { t } = useTranslation('settings');
  // Which sections are on screen. View state, not data: the report already carries every one of
  // them, and this only decides how many are drawn.
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? notes : notes.slice(0, SHOWN_SECTIONS);
  const hidden = notes.length - shown.length;

  return (
    <div className="mt-3 space-y-1">
      {shown.map((note, index) => (
        <Collapsible key={note.version} defaultOpen={index === 0} className="rounded-lg">
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/60">
            <span className="truncate">{note.version}</span>
            <NoteChevron />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="prose prose-sm max-w-none break-words px-2 pb-2 dark:prose-invert">
              <MarkdownPreview content={note.body} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}

      {hidden > 0 && (
        <Button variant="link" size="sm" className="h-auto px-2" onClick={() => setShowAll(true)}>
          {t('updates.notes.showAll', {
            count: notes.length,
            defaultValue: 'Show all {{count}} releases',
          })}
        </Button>
      )}

      {notesReason !== null && (
        <p className="px-2 text-xs text-muted-foreground">{notesReason}</p>
      )}

      <a
        href={changelogUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t('updates.notes.fullChangelog', { defaultValue: 'Full changelog' })}
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
