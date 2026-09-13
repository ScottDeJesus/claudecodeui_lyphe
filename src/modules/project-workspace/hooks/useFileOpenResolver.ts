import { useCallback, useRef } from 'react';

import { api } from '@/shared/api';
import type { Project } from '@/shared/types';

/**
 * "Open this path, optionally at this line."
 *
 * Deliberately NOT `FileOpenHandler`: that type's second parameter is `diffInfo` and
 * `ToolRenderer` already passes a real diff object into it, so a line number riding there
 * would land as a line on every Edit/Write card in the chat. Two capabilities, two signatures.
 */
type FileOpenAtHandler = (path: string, line?: number) => void;

type FileNode = {
  type: 'file' | 'directory';
  name: string;
  path: string;
  children?: FileNode[];
};

type FlatFile = {
  name: string;
  path: string;
};

const normalize = (value: string): string => value.replace(/\\/g, '/');

const flatten = (nodes: FileNode[], out: FlatFile[]): void => {
  for (const node of nodes) {
    if (node.type === 'file') {
      out.push({ name: node.name, path: node.path });
    } else if (node.children && node.children.length > 0) {
      flatten(node.children, out);
    }
  }
};

// References inside chat messages are often bare basenames (`foo.ts`) or partial
// paths (`utils/foo.ts`) rather than full paths, so match by path suffix and
// fall back to filename equality.
const findBestMatch = (files: FlatFile[], ref: string, allowBasename = true): string | null => {
  const target = normalize(ref).replace(/^\.\//, '').replace(/^\/+/, '');
  if (!target) {
    return null;
  }

  const suffixMatch = files.find((file) => {
    const filePath = normalize(file.path);
    return filePath === target || filePath.endsWith(`/${target}`);
  });
  if (suffixMatch) {
    return suffixMatch.path;
  }

  if (!allowBasename) {
    return null;
  }
  const base = target.split('/').pop() || target;
  return files.find((file) => file.name === base)?.path ?? null;
};

/**
 * Resolves a possibly bare/partial file reference against the project's file tree (cached per
 * project), and wraps an "open at a line" handler so the reference is resolved before the file is
 * opened.
 *
 * `resolve` answers the matched project path, or the reference as it came when nothing matched — a
 * file the tree listing leaves out (a git-ignored one) is still addressed by the path the author
 * wrote. `resolve(path, { allowBasename: false })` refuses the filename-only guess, for a caller that
 * shows the file's CONTENT (a picture), where a same-named file elsewhere would be presented as the
 * one the author meant. `open` carries the LINE straight through: resolving a reference answers WHICH file it
 * meant and says nothing about where inside it to look, so the line the caller named survives the
 * lookup unchanged.
 *
 * Both come out of one hook because they share one cache: the workspace opens references and reads
 * them for the chat's inline pictures, and two hooks would list the project tree twice.
 */
export function useFileOpenResolver(
  selectedProject: Project | null | undefined,
  onFileOpen: FileOpenAtHandler,
): { open: FileOpenAtHandler; resolve: (path: string, options?: { allowBasename?: boolean }) => Promise<string> } {
  const projectId = selectedProject?.projectId;
  const cacheRef = useRef<{ projectId?: string; files: Promise<FlatFile[]> | null }>({
    projectId: undefined,
    files: null,
  });

  const loadFiles = useCallback((): Promise<FlatFile[]> => {
    if (!projectId) {
      return Promise.resolve([]);
    }
    if (cacheRef.current.projectId === projectId && cacheRef.current.files) {
      return cacheRef.current.files;
    }

    const filesPromise = (async () => {
      try {
        const response = await api.getFiles(projectId);
        if (!response.ok) {
          return [];
        }
        const data = await response.json();
        const tree: FileNode[] = Array.isArray(data) ? data : [];
        const flat: FlatFile[] = [];
        flatten(tree, flat);
        return flat;
      } catch {
        return [];
      }
    })();

    cacheRef.current = { projectId, files: filesPromise };
    return filesPromise;
  }, [projectId]);

  const resolve = useCallback(
    async (filePath: string, options: { allowBasename?: boolean } = {}): Promise<string> =>
      findBestMatch(await loadFiles(), normalize(filePath).trim(), options.allowBasename ?? true) ?? filePath,
    [loadFiles],
  );

  const open = useCallback<FileOpenAtHandler>(
    (filePath, line) => {
      void resolve(filePath).then((resolved) => onFileOpen(resolved, line));
    },
    [resolve, onFileOpen],
  );

  return { open, resolve };
}
