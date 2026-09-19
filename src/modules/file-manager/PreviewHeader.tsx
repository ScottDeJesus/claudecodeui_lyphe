import { Button, Tabs } from '@/shared/ui';
import type { PreviewToggle, PreviewView } from '@/shared/types';

/** What the preview header needs; rendered by the file-manager module's PreviewPane. */
type PreviewHeaderProps = {
  /** The selected file, project-relative. Null when nothing is selected. */
  selectedPath: string | null;
  /** Whether this file can be opened in the editor — a text file, not already being edited. */
  canEdit: boolean;
  onEdit: () => void;
  /** The two views of a rendered text file (Markdown, CSV/TSV), or null when the file has one. */
  toggle: PreviewToggle | null;
  /** Which of those two views is showing. */
  view: PreviewView;
  onViewChange: (view: PreviewView) => void;
  onDownload: () => void;
};

/**
 * The preview pane's top row: the pane's name, which view of the file is showing, and what can
 * be done with it.
 *
 * Used by the file-manager module's PreviewPane, which owns every value this row reads.
 *
 * The view toggle sits beside the pane's name because it changes what the pane SHOWS; Edit and
 * Download sit at the far end because they are things to DO with the file. Below `md` both
 * buttons are 44px tall, Verve's touch minimum, and the row wraps rather than crowding them.
 */
export function PreviewHeader({ selectedPath, canEdit, onEdit, toggle, view, onViewChange, onDownload }: PreviewHeaderProps) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2.5">
      <span className="text-xs uppercase tracking-[0.14em] text-ink-faint">Preview</span>
      {toggle && (
        <Tabs
          variant="segmented"
          ariaLabel="Preview view"
          tabs={[{ id: 'rendered', label: toggle.renderedLabel }, { id: 'source', label: toggle.sourceLabel }]}
          active={view}
          onChange={(id) => onViewChange(id === 'source' ? 'source' : 'rendered')}
        />
      )}
      {selectedPath && (
        <div className="ml-auto flex items-center gap-2">
          {canEdit && (
            <Button variant="tonal" size="sm" className="max-md:h-11" aria-label="Edit file" onClick={onEdit}>Edit</Button>
          )}
          <Button variant="outline" size="sm" className="max-md:h-11" onClick={onDownload}>Download</Button>
        </div>
      )}
    </div>
  );
}
