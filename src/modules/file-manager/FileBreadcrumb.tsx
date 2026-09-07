/** The project name plus one segment per directory, rendered by the file-manager module's FileManager. */
type FileBreadcrumbProps = {
  projectName: string;
  /** The directory in view, relative to the project root. `''` is the root itself. */
  currentDir: string;
  /** Called with the project-relative directory of the segment clicked; `''` for the project. */
  onNavigate: (directory: string) => void;
};

/**
 * `project ▶ src ▶ modules ▶ sidebar` — every segment but the last is a way back to it.
 *
 * Used by the file-manager module's FileManager, above its listing.
 *
 * The last segment is where you are, so it is bold and inert: a control that does nothing is
 * worse than plain text that never promised to.
 */
export function FileBreadcrumb({ projectName, currentDir, onNavigate }: FileBreadcrumbProps) {
  const segments = currentDir ? currentDir.split('/') : [];

  return (
    <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px]">
      {segments.length === 0 ? (
        <span className="truncate font-medium text-foreground">{projectName}</span>
      ) : (
        <button
          type="button"
          className="truncate text-accent-ink hover:underline"
          onClick={() => onNavigate('')}
        >
          {projectName}
        </button>
      )}

      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        const directory = segments.slice(0, index + 1).join('/');

        return (
          // The path is the key: two sibling folders can share a name, their paths cannot.
          <span key={directory} className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true" className="text-[10px] text-ink-faint">▶</span>
            {isLast ? (
              <span className="truncate font-medium text-foreground">{segment}</span>
            ) : (
              <button
                type="button"
                className="truncate text-accent-ink hover:underline"
                onClick={() => onNavigate(directory)}
              >
                {segment}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
