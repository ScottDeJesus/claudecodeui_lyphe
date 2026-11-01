/**
 * Used by chat's ChatComposer and, through the chat barrel, the companion module's CompanionComposer, drawn over the input box while files are dragged onto it: the dashed frame and its "Drop
 * files here" card. The caller draws it only while the drag is active. `compact` lays the card out as one short row (the glyph beside the
 * words) for a box that is a single row tall, as the companion's is when it holds no file: the chat's tall card would run past its edge.
 */
export function ComposerDropOverlay({ compact = false }: { compact?: boolean }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/15">
      <div className={compact ? 'flex items-center gap-2 rounded-xl border border-border/30 bg-card px-3 py-1.5 shadow-lg' : 'rounded-xl border border-border/30 bg-card p-4 shadow-lg'}>
        <svg className={compact ? 'h-5 w-5 shrink-0 text-primary' : 'mx-auto mb-2 h-8 w-8 text-primary'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="text-sm font-medium">Drop files here</p>
      </div>
    </div>
  );
}
