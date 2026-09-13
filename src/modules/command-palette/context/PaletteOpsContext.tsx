import { createContext, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import type { MutableRefObject, ReactNode } from 'react';

export type PaletteOps = {
  openFile: (path: string) => void;
  // Opens a bare or partial file reference — the text of an in-chat file link —
  // which is resolved against the project before the file manager previews it.
  // `line` is the line the reference named (`foo.ts:42`); the preview opens a window
  // around it and scrolls to it. Absent means the top of the file, as it always did.
  openFileReference: (path: string, line?: number) => void;
  // Reads the bytes of the same kind of reference, resolved against the project the way
  // `openFileReference` resolves it, so a preview drawn in chat and the file its chip opens are one
  // file. Reads are shared within `scope` (one row) and never across scopes, so a later reply naming
  // an overwritten file reads it again; a `null` scope is read and not kept. Answers `null` when there
  // is no project to read from or the file cannot be read.
  readFileReference: (path: string, scope: string | null) => Promise<Blob | null>;
  openSettings: (tab?: string) => void;
  refreshProjects: () => Promise<void> | void;
};

type Registry = MutableRefObject<Partial<PaletteOps>>;

const PaletteOpsContext = createContext<Registry | null>(null);

const defaultOps: PaletteOps = {
  openFile: () => undefined,
  openFileReference: () => undefined,
  readFileReference: () => Promise.resolve(null),
  openSettings: () => undefined,
  refreshProjects: () => undefined,
};

/** Mounted by the project-workspace module so CommandPalette and the chat and sidebar modules share one set of palette operations. */
export function PaletteOpsProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Partial<PaletteOps>>({});
  return <PaletteOpsContext.Provider value={ref}>{children}</PaletteOpsContext.Provider>;
}

export function usePaletteOps(): PaletteOps {
  const ref = useContext(PaletteOpsContext);
  return useMemo<PaletteOps>(
    () => ({
      openFile: (path) => (ref?.current.openFile ?? defaultOps.openFile)(path),
      openFileReference: (path, line) =>
        (ref?.current.openFileReference ?? defaultOps.openFileReference)(path, line),
      readFileReference: (path, scope) =>
        (ref?.current.readFileReference ?? defaultOps.readFileReference)(path, scope),
      openSettings: (tab) => (ref?.current.openSettings ?? defaultOps.openSettings)(tab),
      refreshProjects: () => (ref?.current.refreshProjects ?? defaultOps.refreshProjects)(),
    }),
    [ref],
  );
}

export function usePaletteOpsRegister(partial: Partial<PaletteOps>) {
  const ref = useContext(PaletteOpsContext);
  const { openFile, openFileReference, readFileReference, openSettings, refreshProjects } = partial;

  // A LAYOUT effect: every layout effect of a commit runs before any passive one, so an op whose
  // identity changed (a project switch) is back in the registry before a row mounted in the same
  // commit calls it from its own effect — and does not read the default in between.
  useLayoutEffect(() => {
    if (!ref) return undefined;
    // The provider creates `ref.current` once and only ever mutates its fields,
    // so capturing the registry object here is equivalent to reading
    // `ref.current` in the cleanup — and keeps the cleanup off a live ref read.
    const registry = ref.current;
    const prev = { ...registry };
    if (openFile) registry.openFile = openFile;
    if (openFileReference) registry.openFileReference = openFileReference;
    if (readFileReference) registry.readFileReference = readFileReference;
    if (openSettings) registry.openSettings = openSettings;
    if (refreshProjects) registry.refreshProjects = refreshProjects;
    return () => {
      if (openFile && registry.openFile === openFile) registry.openFile = prev.openFile;
      if (openFileReference && registry.openFileReference === openFileReference) registry.openFileReference = prev.openFileReference;
      if (readFileReference && registry.readFileReference === readFileReference) registry.readFileReference = prev.readFileReference;
      if (openSettings && registry.openSettings === openSettings) registry.openSettings = prev.openSettings;
      if (refreshProjects && registry.refreshProjects === refreshProjects) registry.refreshProjects = prev.refreshProjects;
    };
  }, [ref, openFile, openFileReference, readFileReference, openSettings, refreshProjects]);
}
