import type { ReactNode, RefObject } from 'react';

type ShellMinimalViewProps = {
  terminalContainerRef: RefObject<HTMLDivElement>;
  /** Overlays that belong to the terminal pane — the shortcut strip positions against this box. */
  children?: ReactNode;
};

/** Rendered by Shell in minimal mode to show the bare terminal container without the header or overlays. */
export default function ShellMinimalView({
  terminalContainerRef,
  children,
}: ShellMinimalViewProps) {
  return (
    <div className="relative h-full w-full bg-secondary">
      <div
        ref={terminalContainerRef}
        className="h-full w-full focus:outline-none"
        style={{ outline: 'none' }}
      />
      {children}
    </div>
  );
}
