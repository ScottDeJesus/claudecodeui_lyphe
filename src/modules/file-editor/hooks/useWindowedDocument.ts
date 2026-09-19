import { useCallback, useEffect, useRef, useState } from 'react';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { api } from '@/shared/api';
import type {
  EditWindowMeta,
  FileEditWindow,
  FileEditorStatus,
  FileLinePatch,
  FilePatchResult,
} from '@/shared/types';
import {
  getEditSessionStatus,
  readEditSession,
  registerSaveHandler,
  saveOpenEditSession,
  startEditSession,
  writeEditSession,
} from '@/modules/file-editor/utils/editSessionStore';
import { createEditorSetup } from '@/modules/file-editor/utils/editorSetup';
import { loadLanguageFor } from '@/modules/file-editor/utils/editorLanguages';
import { verveEditorTheme } from '@/modules/file-editor/utils/verveEditorTheme';
import {
  applyEvictBottom,
  applyEvictTop,
  applyWindowAppend,
  applyWindowPrepend,
  clearTouchedSpan,
  computeLinePatch,
  setWindowMeta,
  touchedLines,
  touchedSpanField,
  windowLoad,
  windowMetaField,
} from '@/modules/file-editor/utils/windowedDocument';
import { nextWindowActions, openWindowRequest } from '@/modules/file-editor/utils/windowPolicy';
import { readBody } from '@/modules/file-editor/utils/readBody';
import { visibleLineRange } from '@/modules/file-editor/utils/visibleRange';

/**
 * The file editor's engine: a raw `EditorView` over the windowed document, plus every request,
 * eviction and conflict rule that keeps that window in step with the file on disk.
 *
 * A raw view rather than a React wrapper, because two of the contract's requirements a wrapper
 * cannot express: a session survives unmount as a live `EditorState`, and every window load is a
 * transaction annotated as a load rather than as a person's edit. The engine is one mutable
 * object in a ref, so the callbacks handed out below stay stable for the session's whole life —
 * the editor's keymap captures them once, when the view is built.
 */

type Engine = {
  projectId: string;
  path: string;
  anchorLine: number;
  isDarkMode: boolean;
  host: HTMLDivElement | null;
  view: EditorView | null;
  /** The React state setter, so the engine can publish a status from outside render. */
  setStatus: (status: FileEditorStatus) => void;
  /** The last status published, held so an unchanged one does not re-render the editor. */
  lastStatus: FileEditorStatus | null;
  phase: FileEditorStatus['phase'];
  message: string | null;
  longLineStop: number | null;
  /** True once a real window is in the view; nothing is planned or persisted before that. */
  loaded: boolean;
  /** True while a mount owns this engine; only then may a view be built into the host. */
  started: boolean;
  pendingUp: boolean;
  pendingDown: boolean;
  /** A direction that cannot be fetched further: a too-long line, an answer that stopped short. */
  upStopped: boolean;
  downStopped: boolean;
  /** Bumped on every mount and unmount, so an answer that arrives late is dropped. */
  lifecycle: number;
  raf: number | null;
  /**
   * The write in flight, or null. Held so a second save JOINS the one already going out rather
   * than PATCHing the same revision again — which the server would refuse as a conflict, drawing
   * "changed on disk" over the reader's own text.
   */
  savePromise: Promise<boolean> | null;
  /**
   * The scroller's offset, kept live by the scroll listener. The unmount cleanup cannot read it
   * off the DOM: React runs that cleanup after the scroller has left the page, and a detached
   * node reports 0 — so the offset a restored session would come back to is the one recorded here.
   */
  scrollTop: number;
  /** The compartments of the states this engine built, and the grammar loaded for this file. */
  language: Compartment | null;
  theme: Compartment | null;
  languageExtension: Extension | null;
};

/**
 * The status listener's compartment, shared by every state a windowed document builds.
 *
 * A restored session carries the state its previous mount created — listener included. One
 * compartment lets a new mount replace that listener, so a document rebuilt from the store
 * reports its status to the component that is actually on screen.
 */
const statusListener = new Compartment();

/** Lines a viewport holds: V, floored at 20 lines and measured before the view exists. */
function viewportLines(engine: Engine): number {
  const view = engine.view;
  if (!view) return Math.max(20, Math.ceil((engine.host?.clientHeight ?? 0) / 20));
  return Math.max(20, Math.ceil(view.scrollDOM.clientHeight / (view.defaultLineHeight || 20)));
}

/** The server's own sentence out of a refused request. */
async function failureMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === 'string' && body.error.length > 0
    ? body.error
    : `Request failed (${response.status})`;
}

/**
 * The sentence a request that never got an answer carries: a dropped connection, or a fetch that
 * ran past the client's own timeout. `fetch` rejects rather than answering, and a rejection left
 * unhandled would strand the editor in "Saving…"/"Reading…" with nothing on screen to try again.
 */
function thrownMessage(cause: unknown): string {
  return cause instanceof Error && cause.message.length > 0
    ? cause.message
    : 'the request could not be sent';
}

/**
 * Records an answer that cannot be used AND ends the fetch waiting on it, in one act: a refusal that
 * skipped its half of the bookkeeping is how a direction stayed marked in flight for good.
 */
function failFetch(engine: Engine, message: string, settle?: () => void): void {
  settle?.();
  engine.phase = 'error';
  engine.message = message;
  publishStatus(engine);
}

/** True when two published statuses are the same, so an unchanged one does not re-render. */
function sameStatus(a: FileEditorStatus | null, b: FileEditorStatus): boolean {
  return (
    a !== null &&
    a.phase === b.phase &&
    a.dirty === b.dirty &&
    a.firstLine === b.firstLine &&
    a.lastLine === b.lastLine &&
    a.totalLines === b.totalLines &&
    a.message === b.message &&
    a.longLineStop === b.longLineStop
  );
}

/** Publishes what the editor shows about itself, and keeps the store's dirty flag current. */
function publishStatus(engine: Engine): void {
  const view = engine.view;
  const meta = view ? view.state.field(windowMetaField) : null;
  const doc = view ? view.state.doc : null;
  const dirty = view ? view.state.field(touchedSpanField) !== null : false;
  // The document's line count is CodeMirror's, one line even when it is empty: that is the line
  // the gutter numbers, and the line `computeLinePatch` replaces. An empty file alone counts as
  // no lines, and that is `origCount`'s business, not the document's.
  const docLines = doc === null ? 0 : doc.lines;
  const status: FileEditorStatus = {
    phase: engine.phase,
    dirty,
    firstLine: meta ? meta.lo : engine.anchorLine,
    lastLine: meta ? meta.lo + docLines - 1 : engine.anchorLine,
    totalLines:
      meta && meta.totalLines !== null ? meta.totalLines + (docLines - meta.origCount) : null,
    message: engine.message,
    longLineStop: engine.longLineStop,
  };
  if (sameStatus(engine.lastStatus, status)) return;
  const previous = engine.lastStatus;
  engine.lastStatus = status;
  if (previous === null || previous.dirty !== dirty) {
    writeEditSession({ projectId: engine.projectId, path: engine.path, dirty });
  }
  engine.setStatus(status);
}

/**
 * The extensions every state this engine builds carries: the editor setup plus its listener.
 *
 * `onSave` goes through the store rather than naming `engine`, because the keymap is built INTO
 * the state: a restored session puts the previous mount's state back on screen, and that state's
 * binding closes over the engine of a mount whose view the unmount destroyed — Mod-s would find
 * no view and save nothing, silently. The store holds the save of whichever mount is on screen
 * (the same effect that registers it for the file manager), so the key always reaches the live one.
 */
function buildExtensions(engine: Engine): Extension[] {
  const setup = createEditorSetup({
    isDarkMode: engine.isDarkMode,
    onSave: () => void saveOpenEditSession(),
  });
  engine.language = setup.language;
  engine.theme = setup.theme;
  return [
    ...setup.extensions,
    statusListener.of(EditorView.updateListener.of(() => publishStatus(engine))),
  ];
}

/** Puts the grammar loaded for this file into the view's language compartment. */
function applyLanguage(engine: Engine): void {
  const view = engine.view;
  if (view && engine.language) {
    view.dispatch({ effects: engine.language.reconfigure(engine.languageExtension ?? []) });
  }
}

/** Runs the policy against the live view and performs whatever it asks for. */
function planWindow(engine: Engine): void {
  const view = engine.view;
  if (!view || !engine.loaded || engine.phase === 'conflict' || engine.phase === 'error') return;
  const doc = view.state.doc;
  const meta = view.state.field(windowMetaField);
  const span = touchedLines(view.state);
  const visible = visibleLineRange(view);
  const actions = nextWindowActions({
    lo: meta.lo,
    origCount: meta.origCount,
    docLines: doc.lines,
    eof: meta.eof,
    top: visible.top,
    bottom: visible.bottom,
    viewportLines: viewportLines(engine),
    touchedFirst: span ? span.first : null,
    touchedLast: span ? span.last : null,
    pending: {
      up: engine.pendingUp || engine.upStopped,
      down: engine.pendingDown || engine.downStopped,
    },
  });
  for (const action of actions) {
    if (action.kind === 'prepend') {
      void requestWindow(engine, 'up', action.start, action.lines, meta.lo);
    } else if (action.kind === 'append') {
      void requestWindow(engine, 'down', action.start, action.lines, meta.lo + meta.origCount);
    } else if (action.kind === 'evictTop') {
      applyEvictTop(view, action.count);
    } else {
      applyEvictBottom(view, action.count);
    }
  }
}

/** Records that the view must be re-planned once a frame, not on every scroll event. */
function schedulePlan(engine: Engine): void {
  if (engine.raf !== null) return;
  engine.raf = requestAnimationFrame(() => {
    engine.raf = null;
    planWindow(engine);
  });
}

/**
 * Fetches one window and applies it if it still belongs to the document.
 *
 * `edge` is the border the request extends, as it stood when the request went out. A save, an
 * eviction or another load moves that border, and an answer computed against the old one would
 * splice lines into the wrong place — so the answer is dropped instead.
 */
async function requestWindow(
  engine: Engine,
  direction: 'up' | 'down',
  start: number,
  lines: number,
  edge: number,
): Promise<void> {
  const view = engine.view;
  if (!view) return;
  const token = engine.lifecycle;
  if (direction === 'up') engine.pendingUp = true;
  else engine.pendingDown = true;
  // The direction frees up only once its answer has been APPLIED, never when its headers arrive:
  // reading the body is an await, and a plan running inside it would see the direction idle and
  // ask for the same lines again — a range fetched twice, the second copy dropped as its edge
  // moved. Every path below settles the direction exactly when it stops extending it.
  const settle = (): void => {
    if (direction === 'up') engine.pendingUp = false;
    else engine.pendingDown = false;
  };
  let response: Response;
  try {
    response = await api.editWindow(engine.projectId, engine.path, start, lines);
  } catch (cause) {
    if (token !== engine.lifecycle || engine.view !== view) return;
    settle();
    // Nothing came back at all — a dropped connection, or a request that ran past its timeout.
    // The window on screen is still sound and still the reader's to edit, so the document stays:
    // what stops is the fetching, because a direction that keeps asking a dead server fails the
    // same way every scroll. The banner says what happened and offers the retry.
    engine.phase = 'error';
    engine.message = `Couldn't read — ${thrownMessage(cause)}`;
    publishStatus(engine);
    return;
  }
  if (token !== engine.lifecycle || engine.view !== view) return;
  if (!response.ok) {
    settle();
    if (response.status === 422) {
      // A line inside the window is too long to edit here: that direction stops, and the banner
      // names the first line we could not read.
      engine.longLineStop = start;
      if (direction === 'up') engine.upStopped = true;
      else engine.downStopped = true;
      publishStatus(engine);
    }
    return;
  }
  const win = await readBody<FileEditWindow>(response, 'lines');
  if (win === null) {
    failFetch(engine, `Couldn't read — the answer was not a window`, settle);
    return;
  }
  const meta = view.state.field(windowMetaField);
  if (win.rev !== meta.rev) {
    settle();
    handleRevisionDrift(engine);
    return;
  }
  const edgeHeld = direction === 'up' ? meta.lo === edge : meta.lo + meta.origCount === edge;
  if (!edgeHeld) {
    settle();
    return;
  }
  settle();
  const applied =
    direction === 'up' ? applyWindowPrepend(view, win) : applyWindowAppend(view, win);
  if (!applied) {
    if (direction === 'up') engine.upStopped = true;
    else engine.downStopped = true;
  }
  publishStatus(engine);
  planWindow(engine);
}

/** A read answered from a different revision: reload if the document is clean, else stop. */
function handleRevisionDrift(engine: Engine): void {
  const view = engine.view;
  if (!view) return;
  if (view.state.field(touchedSpanField) === null) {
    void reloadFromDisk(engine);
    return;
  }
  engine.phase = 'conflict';
  engine.message = null;
  publishStatus(engine);
}

/**
 * Reads a window and puts it in the view — as a fresh state, or as one annotated transaction —
 * or reports why it could not be read.
 */
async function loadWindowAt(
  engine: Engine,
  start: number,
  lines: number,
  freshHistory: boolean,
): Promise<void> {
  const view = engine.view;
  if (!view) return;
  const token = engine.lifecycle;
  let response: Response;
  try {
    response = await api.editWindow(engine.projectId, engine.path, start, lines);
  } catch (cause) {
    if (token !== engine.lifecycle || engine.view !== view) return;
    // The request never reached an answer. The editor is still on screen and a save is still
    // possible, so this reads as a failed READ: the banner carries the reason and Try again reads
    // the file again, which is the same shape a refused window takes.
    engine.phase = 'error';
    engine.message = `Couldn't open — ${thrownMessage(cause)}`;
    publishStatus(engine);
    return;
  }
  if (token !== engine.lifecycle || engine.view !== view) return;
  if (!response.ok) {
    // The first window failing is the file itself: there is nothing to edit, so the editor says
    // so instead of showing an empty document that would save over the file.
    engine.phase = 'error';
    engine.message = await failureMessage(response);
    publishStatus(engine);
    return;
  }
  const win = await readBody<FileEditWindow>(response, 'lines');
  if (win === null) {
    failFetch(engine, `Couldn't open — the answer was not a window`);
    return;
  }
  const meta: EditWindowMeta = {
    lo: win.startLine,
    origCount: win.lines.length,
    eof: win.eof,
    rev: win.rev,
    eol: win.eol,
    totalLines: win.totalLines,
  };
  const text = win.lines.join('\n');
  if (freshHistory) {
    const state: EditorState = EditorState.create({
      doc: text,
      extensions: buildExtensions(engine),
    })
      .update({ effects: setWindowMeta.of(meta) })
      .state;
    view.setState(state);
  } else {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      effects: [setWindowMeta.of(meta), clearTouchedSpan.of(null)],
      annotations: [windowLoad.of(true), Transaction.addToHistory.of(false)],
      scrollIntoView: false,
    });
  }
  engine.loaded = true;
  engine.phase = 'ready';
  engine.message = null;
  engine.longLineStop = null;
  engine.upStopped = false;
  engine.downStopped = false;
  // A state built from scratch starts with an empty language compartment; the grammar this file
  // loaded goes back in, so a reload or a discard does not silently drop syntax highlighting.
  applyLanguage(engine);
  publishStatus(engine);
  planWindow(engine);
}

/** Re-reads the file around the line at the viewport's top, throwing the edits away. */
async function reloadFromDisk(engine: Engine): Promise<void> {
  const view = engine.view;
  if (!view) return;
  const doc = view.state.doc;
  const request = openWindowRequest(
    doc.lineAt(Math.min(view.viewport.from, doc.length)).number,
    viewportLines(engine),
  );
  engine.phase = 'loading';
  publishStatus(engine);
  await loadWindowAt(engine, request.start, request.lines, true);
}

/** Writes one computed patch; false when the write did not land. */
async function writePatch(engine: Engine, view: EditorView, patch: FileLinePatch): Promise<boolean> {
  // The text this request is about to land. A document that reads differently when the answer
  // comes back has been typed in WHILE the write was in flight, and those keystrokes are not in
  // it — so the touched span is not cleared for them (see below).
  const textWritten = view.state.doc.toString();
  engine.phase = 'saving';
  engine.message = null;
  publishStatus(engine);
  const token = engine.lifecycle;
  let response: Response;
  try {
    response = await api.patchFile(engine.projectId, patch);
  } catch (cause) {
    if (token !== engine.lifecycle || engine.view !== view) return false;
    // No answer at all. The reader's edits are still here and still theirs to retry, so the phase
    // is 'error' (Save stays live, the banner carries the reason) rather than staying on 'saving',
    // which would disable Save and say "Saving…" about a request that is already dead.
    engine.phase = 'error';
    engine.message = `Couldn't save — ${thrownMessage(cause)}`;
    publishStatus(engine);
    return false;
  }
  if (token !== engine.lifecycle || engine.view !== view) return false;
  if (!response.ok) {
    if (response.status === 409) {
      engine.phase = 'conflict';
      engine.message = null;
    } else {
      engine.phase = 'error';
      engine.message = `Couldn't save — ${await failureMessage(response)}`;
    }
    publishStatus(engine);
    return false;
  }
  const result = await readBody<FilePatchResult>(response, 'rev');
  if (result === null) {
    failFetch(engine, `Couldn't save — the answer was not a save`);
    return false;
  }
  const meta = view.state.field(windowMetaField);
  const doc = view.state.doc;
  // The window now stands at `doc.lines` original lines — which is one for a document that reads
  // empty, because the save left one empty line in the file. Only the empty-file exception
  // (`computeLinePatch`'s window at line 1 reaching EOF) wrote no lines at all, and there the
  // window represents none.
  const savedAnEmptyFile = doc.length === 0 && meta.lo === 1 && meta.eof;
  const lineDelta = (savedAnEmptyFile ? 0 : doc.lines) - meta.origCount;
  // The span is cleared only for a document that still reads as the one that was written. One
  // that moved on stays dirty, which is what it is: the next save is what carries those lines.
  const typedDuring = doc.toString() !== textWritten;
  view.dispatch({
    effects: [
      setWindowMeta.of({
        ...meta,
        rev: result.rev,
        origCount: savedAnEmptyFile ? 0 : doc.lines,
        totalLines: meta.eof
          ? result.totalLines
          : meta.totalLines === null
            ? null
            : meta.totalLines + lineDelta,
      }),
      ...(typedDuring ? [] : [clearTouchedSpan.of(null)]),
    ],
  });
  engine.phase = 'ready';
  engine.message = null;
  publishStatus(engine);
  planWindow(engine);
  return true;
}

/**
 * Writes the touched lines back to the file; false when the write did not land.
 *
 * A save already on its way answers this one with its own result. Mod-s can repeat faster than a
 * write can land, and two PATCHes of the same revision make the server refuse the second — drawing
 * "changed on disk" over a file nobody else touched, which is a worse lie than a joined write.
 */
async function saveOpen(engine: Engine): Promise<boolean> {
  const view = engine.view;
  if (!view || !engine.loaded) return false;
  if (engine.savePromise !== null) return engine.savePromise;
  const patch = computeLinePatch(view.state, engine.path);
  if (patch === null) return true;
  const pending = writePatch(engine, view, patch);
  engine.savePromise = pending;
  try {
    return await pending;
  } finally {
    engine.savePromise = null;
  }
}

/** Puts the touched lines on the clipboard, and answers how many there were. */
async function copyEdits(engine: Engine): Promise<number> {
  const view = engine.view;
  if (!view) return 0;
  const span = touchedLines(view.state);
  if (span === null) return 0;
  const doc = view.state.doc;
  const lines: string[] = [];
  for (let line = span.first; line <= span.last; line += 1) lines.push(doc.line(line).text);
  await navigator.clipboard.writeText(lines.join(view.state.field(windowMetaField).eol));
  return lines.length;
}

/** Writes the live state back to the store, before the view that owns it is destroyed. */
function persistSession(engine: Engine): void {
  const view = engine.view;
  if (!view || !engine.loaded) return;
  // React runs this cleanup once the subtree is out of the document, and a scroller that is no
  // longer in the page reports 0 — writing that would bring the reader back to the top of their
  // file. The offset kept by the scroll listener is the one to store; a view still in the page is
  // read directly, because there the DOM is the truth.
  if (view.scrollDOM.isConnected) engine.scrollTop = view.scrollDOM.scrollTop;
  writeEditSession({
    projectId: engine.projectId,
    path: engine.path,
    state: view.state,
    scrollTop: engine.scrollTop,
    dirty: view.state.field(touchedSpanField) !== null,
  });
}

/**
 * Builds the editor into the host, once the session is open and the host exists.
 *
 * Idempotent, and called both from the mount effect and from the ref callback: a component that
 * draws its editor host only after it has something to show would otherwise never get a view,
 * because the ref attaches a render later than the effect runs.
 */
function ensureView(engine: Engine): void {
  const host = engine.host;
  if (!engine.started || !host || engine.view !== null) return;
  const record = readEditSession(engine.projectId, engine.path);
  const view = new EditorView({
    state: record?.state ?? EditorState.create({ doc: '', extensions: buildExtensions(engine) }),
    parent: host,
  });
  engine.view = view;
  view.scrollDOM.addEventListener('scroll', () => {
    // Recorded as the reader scrolls, because the unmount cleanup cannot read it: by then this
    // scroller has left the document and reports 0.
    engine.scrollTop = view.scrollDOM.scrollTop;
    schedulePlan(engine);
  });
  if (record?.state) {
    // The restored state's listener belongs to the mount that built it; point the compartment at
    // this one so status changes keep arriving.
    view.dispatch({
      effects: statusListener.reconfigure(EditorView.updateListener.of(() => publishStatus(engine))),
    });
    engine.scrollTop = record.scrollTop;
    view.scrollDOM.scrollTop = record.scrollTop;
    engine.loaded = true;
    engine.phase = 'ready';
  } else {
    const request = openWindowRequest(engine.anchorLine, viewportLines(engine));
    void loadWindowAt(engine, request.start, request.lines, false);
  }
  publishStatus(engine);
}

/** Consumed by FileEditor, the only component that puts an editor on screen. */
export function useWindowedDocument(input: {
  projectId: string;
  path: string;
  anchorLine: number;
  isDarkMode: boolean;
}): {
  hostRef: (element: HTMLDivElement | null) => void;
  status: FileEditorStatus;
  save: () => Promise<boolean>;
  reloadFromDisk: () => Promise<void>;
  copyEdits: () => Promise<number>;
  discard: () => void;
} {
  const { projectId, path, anchorLine, isDarkMode } = input;
  const engineRef = useRef<Engine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = {
      projectId,
      path,
      anchorLine,
      isDarkMode,
      host: null,
      view: null,
      setStatus: () => {},
      lastStatus: null,
      phase: 'loading',
      message: null,
      longLineStop: null,
      loaded: false,
      started: false,
      pendingUp: false,
      pendingDown: false,
      upStopped: false,
      downStopped: false,
      lifecycle: 0,
      raf: null,
      savePromise: null,
      scrollTop: 0,
      language: null,
      theme: null,
      languageExtension: null,
    };
  }
  const engine = engineRef.current;
  engine.projectId = projectId;
  engine.path = path;
  engine.anchorLine = anchorLine;
  engine.isDarkMode = isDarkMode;

  const [status, setStatus] = useState<FileEditorStatus>(() => ({
    phase: 'loading',
    dirty: false,
    firstLine: anchorLine,
    lastLine: anchorLine,
    totalLines: null,
    message: null,
    longLineStop: null,
  }));
  engine.setStatus = setStatus;

  // A stable callback ref, so React never detaches and reattaches the host mid-session: the host
  // is where the editor lives, and re-creating it would take the session's state with it.
  const hostRef = useCallback(
    (element: HTMLDivElement | null) => {
      engine.host = element;
      ensureView(engine);
    },
    [engine],
  );

  useEffect(() => {
    engine.lifecycle += 1;
    // A new file is a new document: what the previous one had fetched, given up on or was still
    // waiting for does not carry over, and the file starts out loading.
    engine.started = true;
    engine.loaded = false;
    engine.phase = 'loading';
    engine.message = null;
    engine.longLineStop = null;
    engine.pendingUp = false;
    engine.pendingDown = false;
    engine.upStopped = false;
    engine.downStopped = false;
    if (readEditSession(projectId, path) === null) startEditSession(projectId, path, engine.anchorLine);
    registerSaveHandler(() => saveOpen(engine));
    ensureView(engine);
    publishStatus(engine);

    return () => {
      engine.started = false;
      engine.lifecycle += 1;
      persistSession(engine);
      engine.view?.destroy();
      engine.view = null;
      engine.loaded = false;
      engine.pendingUp = false;
      engine.pendingDown = false;
      // A frame already asked for would otherwise leave the flag set forever, and the next
      // session would never plan another window.
      if (engine.raf !== null) cancelAnimationFrame(engine.raf);
      engine.raf = null;
      if (getEditSessionStatus()?.path === path) registerSaveHandler(null);
    };
  }, [engine, projectId, path]);

  useEffect(() => {
    const view = engine.view;
    if (view && engine.theme) {
      view.dispatch({ effects: engine.theme.reconfigure(verveEditorTheme(isDarkMode)) });
    }
  }, [engine, isDarkMode]);

  useEffect(() => {
    let cancelled = false;
    void loadLanguageFor(path).then(
      (language) => {
        if (cancelled) return;
        engine.languageExtension = language;
        applyLanguage(engine);
      },
      // A grammar that could not be fetched — an offline chunk — leaves the file as plain text
      // rather than as a rejection nobody handles beside a document the reader can still edit.
      () => {
        if (cancelled) return;
        engine.languageExtension = null;
        applyLanguage(engine);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [engine, path]);

  const save = useCallback(() => saveOpen(engine), [engine]);
  const reload = useCallback(() => reloadFromDisk(engine), [engine]);
  const copyTouched = useCallback(() => copyEdits(engine), [engine]);
  // Discarding is the same act as reloading: the edits are gone either way, and the window that
  // comes back is centred on where the person was looking.
  const discard = useCallback(() => void reloadFromDisk(engine), [engine]);

  return { hostRef, status, save, reloadFromDisk: reload, copyEdits: copyTouched, discard };
}
