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
const findBestMatch = (files: FlatFile[], ref: string): string | null => {
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

  const base = target.split('/').pop() || target;
  return files.find((file) => file.name === base)?.path ?? null;
};

/**
 * Wraps an "open at a line" handler so a possibly bare/partial file reference is
 * resolved against the project's file tree (cached per project) before the file
 * is opened.
 *
 * The LINE is carried straight through: resolving a reference answers WHICH file it meant and
 * says nothing about where inside it to look, so the line the caller named survives the lookup
 * unchanged — including when no match is found and the reference is opened as it came.
 */
export function useFileOpenResolver(
  selectedProject: Project | null | undefined,
  onFileOpen: FileOpenAtHandler,
): FileOpenAtHandler {
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

  return useCallback<FileOpenAtHandler>(
    (filePath, line) => {
      const ref = normalize(filePath).trim();
      void loadFiles().then((files) => {
        const match = findBestMatch(files, ref);
        onFileOpen(match ?? filePath, line);
      });
    },
    [loadFiles, onFileOpen],
  );
}
