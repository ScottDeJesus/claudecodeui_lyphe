/**
 * Kaylee Station's glyph, as the wheel of places was drawn: her body and the ring that orbits it. Drawn with a lucide glyph's props
 * (`className`, `strokeWidth`), so a place carries it as any other. Used by this module's `PlacesProvider`, the station's place on the
 * wheel and in the palette's Places group.
 */
export function StationGlyph({ className, strokeWidth = 2 }: { className?: string; strokeWidth?: string | number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M2.6 14.2c1.6 2.6 8.6 3 13.2 1.1s7.3-5.6 5.6-8.4" />
    </svg>
  );
}
