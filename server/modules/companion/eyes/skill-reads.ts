import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { parseFrontMatter } from '@/shared/frontmatter.js';
import { guardedToolResult, textResult, type ToolTextResult } from '@/shared/tool-text-result.js';
import { expandHome, findProviderSkillMarkdownFiles, readProviderSkillMarkdownDefinitionFromContent } from '@/shared/utils.js';

import { toolLine } from '../session/companion-prompt.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';
import { listVisibleProjects } from '../tools/house-reads.js';

import { LIST_ABOUT_NOTHING, NOTE_ABOUT_NOTHING } from './card-shapes.js';
import { LIST_MAX, toPanel } from './eyes-answer.js';
import { clipLine, fitLines } from './line-words.js';

/**
 * Her eyes on the house's skills and agents: `lookup_skills` is a POINTER lookup, read from disk the moment she calls it and
 * never before. Nothing of a skill or an agent is in her prompt: her TOOLS line names the tool and nothing else (the operator's
 * ruling: her prompt must not grow a list of skills), so the index enters her context only when she looks, and then as
 * pointers, never a skill's body.
 *
 * WHAT IT READS, at call time, the same files the sessions load: the user-level skills (`~/.claude/skills/<name>/SKILL.md`,
 * through the SKILL.md reader the skills panel uses, `@/shared/utils.js`), the user-level agents (`~/.claude/agents/<name>.md`,
 * the shims `generate_soul_agents.py` writes from the souls' charters at `~/.claude/charters/<name>/SKILL.md`), and for every
 * visible project (`listVisibleProjects`, `tools/house-reads.ts`) its `.claude/skills`, `.agents/skills` and `.claude/agents`.
 * A folder is read ONCE, as the first root that names it (a project registered at his home folder would read `~/.claude/skills`
 * again as that project's). A folder that is not there reads as empty; a file that cannot be read or parsed is left out, as the
 * skills panel leaves it out. Nothing is cached: every call reads the folders again.
 *
 * `lookup_skills(scope, panel)`: `all` or `list` is the whole index, one line each, `<name> · <kind> · <where>`; `skills` or
 * `agents` is one kind of it. An EXACT name (a leading `/` or `$` set aside) is that entry's pointer in full: the index line,
 * what it is for (its frontmatter description, cut at 400 characters), its file, a soul's charter, how a session invokes it
 * (typed as `/<name>`, the Skill tool, the Agent tool's `subagent_type`; a `.agents/skills` skill is read from its file and is
 * no slash command) and what an agent runs as. A name several entries share (a user-level agent and a project's skill of the
 * same name) answers every pointer. Anything else is a PHRASE: every word of it must stand in an entry's name, purpose or
 * where; one line per fit, `<name> · <kind> · <purpose, cut at 110> · <where>`.
 *
 * A list answers the lines that fit the inline limit (`fitLines`: LIST_MAX lines for a phrase, every line for the index) and
 * says how many were left; `panel: true` puts the WHOLE answer on his panel as a `list` (a pointer as a `note`). No dactyl ever
 * reads for this tool. READ-ONLY: it never runs a skill and never launches an agent. No focus, no activity (she stays
 * `thinking`). A refusal is `deps.refuse(sentence)`. `clipLine` folds every name, purpose and path to one line and masks a
 * credential, so no file can forge a line of the answer (INV-9773's lesson).
 *
 * Consumer: `tools/companion-tools.ts` (`buildCompanionTools`), once per account, after `houseReads`.
 */

const SCOPE_MAX = 200;
/** How much of a purpose a list line carries, and how much a pointer carries; the file holds the rest. */
const PURPOSE_LINE_MAX = 110;
const PURPOSE_FULL_MAX = 400;
/** How long a name or a where may stand in a line, and a path, an invocation or a runs-as. */
const WORD_MAX = 80;
const PATH_MAX = 300;
/** The `where` of a user-level entry; a project-level one says the project's display name. */
const USER_LEVEL = 'user-level';

/** `panel`, as every eyes tool takes it. */
const PANEL_FIELD = z
  .boolean()
  .optional()
  .describe('true puts the whole answer on his panel as a card and tells you only that it is there; the answer never enters your context. Leave out to read it yourself.');

type Args = { scope: string; panel?: boolean };

type Kind = 'skill' | 'agent';

/** One entry of the index: the pointer to a skill or an agent, never its body. */
type Pointer = {
  name: string;
  kind: Kind;
  /** Its frontmatter description; '' when it has none. */
  purpose: string;
  /** `user-level`, or the display name of the project whose folder holds it. */
  where: string;
  /** The absolute path of its file. */
  file: string;
  /** How a session invokes it. */
  invoke: string;
  /** An agent's model, effort and tools as its frontmatter says them; '' when it says none. */
  runsAs: string;
  /** A soul's canonical charter, when the agent file is generated from one. */
  charter: string | null;
};

/** A folder entries are read from; `project` is null for a user-level root. */
type Root = { where: string; dir: string; project: string | null };

const KIND_ORDER: Record<Kind, number> = { skill: 0, agent: 1 };

//----------------- the files, read now ------------

/** The frontmatter of a file as a record; a file with none, or with a frontmatter that is not a map, reads as `{}`. */
function frontmatterOf(content: string): Record<string, unknown> {
  const data: unknown = parseFrontMatter(content).data;
  return data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

/** A frontmatter field as one trimmed string: a string as it is, a list of strings joined by ", "; null when absent or empty. */
function fieldOf(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    const words = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item !== '');
    return words.length > 0 ? words.join(', ') : null;
  }
  return null;
}

/** A frontmatter flag; null when absent or not a boolean. */
function flagOf(data: Record<string, unknown>, key: string): boolean | null {
  const value = data[key];
  return typeof value === 'boolean' ? value : null;
}

/**
 * How a session invokes a skill. A skill under `.claude/skills` is typed as `/<name>` unless its frontmatter says
 * `user-invocable: false`, and is the Skill tool's unless it says `disable-model-invocation: true` (the CLI's own two flags).
 * A skill under `.agents/skills` is the cross-tool convention the CLI does not load: a session reads it from its file.
 */
function skillInvoke(name: string, data: Record<string, unknown>, root: Root, loose: boolean): string {
  const inProject = root.project === null ? '' : ` in a session in ${root.project}`;
  if (loose) return `read from its file by a session${inProject}; not a slash command`;
  const doors = [
    flagOf(data, 'user-invocable') === false ? null : `typed as /${name}`,
    flagOf(data, 'disable-model-invocation') === true ? null : `the Skill tool with skill "${name}"`,
  ].filter((door): door is string => door !== null);
  if (doors.length === 0) return `no door${inProject}: its frontmatter forbids both typing it and the Skill tool`;
  return `${doors.join(', or ')}${inProject}`;
}

/** The skills of one root, `<root>/<name>/SKILL.md` each, through the SKILL.md reader the skills panel uses. */
async function readSkills(root: Root, loose: boolean): Promise<Pointer[]> {
  const files = await findProviderSkillMarkdownFiles(root.dir);
  const pointers = await Promise.all(
    files.map(async (file): Promise<Pointer | null> => {
      try {
        const content = await readFile(file, 'utf8');
        const { name, description } = readProviderSkillMarkdownDefinitionFromContent(content, path.basename(path.dirname(file)));
        return { name, kind: 'skill', purpose: description, where: root.where, file, invoke: skillInvoke(name, frontmatterOf(content), root, loose), runsAs: '', charter: null };
      } catch {
        return null; // a file that cannot be read or parsed is left out, as the skills panel leaves it out
      }
    })
  );
  return pointers.filter((pointer): pointer is Pointer => pointer !== null);
}

/** A soul's charter, `~/.claude/charters/<stem>/SKILL.md`, when the agent file is a shim generated from it. */
async function charterOf(home: string, stem: string): Promise<string | null> {
  const file = path.join(home, 'charters', stem, 'SKILL.md');
  try {
    return (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

/** The agents of one root, `<root>/<name>.md` each (a sub-folder such as `agents/mcp` is not an agent). */
async function readAgents(root: Root, home: string): Promise<Pointer[]> {
  const entries = await readdir(root.dir, { withFileTypes: true }).catch(() => []); // a project with no agents folder
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')).map((entry) => path.join(root.dir, entry.name));
  const inProject = root.project === null ? '' : ` in a session in ${root.project}`;
  const pointers = await Promise.all(
    files.map(async (file): Promise<Pointer | null> => {
      try {
        const content = await readFile(file, 'utf8');
        const stem = path.basename(file, '.md');
        const { name, description } = readProviderSkillMarkdownDefinitionFromContent(content, stem);
        const data = frontmatterOf(content);
        const runsAs = (['model', 'effort', 'tools'] as const)
          .flatMap((key) => {
            const value = fieldOf(data, key);
            return value === null ? [] : [`${key} ${value}`];
          })
          .join(', ');
        return {
          name,
          kind: 'agent',
          purpose: description,
          where: root.where,
          file,
          invoke: `the Agent tool with subagent_type "${name}"${inProject}`,
          runsAs,
          charter: root.project === null ? await charterOf(home, stem) : null,
        };
      } catch {
        return null;
      }
    })
  );
  return pointers.filter((pointer): pointer is Pointer => pointer !== null);
}

/** The whole index, read now: the user-level roots, then every visible project's; a folder two roots name is read once, as the first. */
async function readIndex(): Promise<Pointer[]> {
  const home = expandHome('~/.claude');
  const projects = listVisibleProjects();
  const seen = new Set<string>();
  const once = (root: Root): boolean => {
    const dir = path.resolve(root.dir);
    if (seen.has(dir)) return false;
    seen.add(dir);
    return true;
  };
  const skillRoots: Array<{ root: Root; loose: boolean }> = [
    { root: { where: USER_LEVEL, dir: path.join(home, 'skills'), project: null }, loose: false },
    ...projects.flatMap((project) => [
      { root: { where: project.name, dir: path.join(project.path, '.claude', 'skills'), project: project.name }, loose: false },
      { root: { where: project.name, dir: path.join(project.path, '.agents', 'skills'), project: project.name }, loose: true },
    ]),
  ].filter(({ root }) => once(root));
  const agentRoots: Root[] = [
    { where: USER_LEVEL, dir: path.join(home, 'agents'), project: null },
    ...projects.map((project) => ({ where: project.name, dir: path.join(project.path, '.claude', 'agents'), project: project.name })),
  ].filter(once);
  const read = await Promise.all([...skillRoots.map(({ root, loose }) => readSkills(root, loose)), ...agentRoots.map((root) => readAgents(root, home))]);
  return read.flat().sort(byKindWhereName);
}

/** Skills before agents, user-level before a project's, then by project and by name. */
function byKindWhereName(a: Pointer, b: Pointer): number {
  return (
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    Number(a.where !== USER_LEVEL) - Number(b.where !== USER_LEVEL) ||
    a.where.localeCompare(b.where) ||
    a.name.localeCompare(b.name)
  );
}

//----------------- the lines ------------

/** `<name> · <kind> · <where>`: a line of the index. Every part is folded to one line (`clipLine`), so no file forges a line. */
function indexLine(pointer: Pointer): string {
  return `${clipLine(pointer.name, WORD_MAX)} · ${pointer.kind} · ${clipLine(pointer.where, WORD_MAX)}`;
}

/** `<name> · <kind> · <purpose> · <where>`: a line of a phrase's fits. */
function foundLine(pointer: Pointer): string {
  return `${clipLine(pointer.name, WORD_MAX)} · ${pointer.kind} · ${clipLine(pointer.purpose || 'no description', PURPOSE_LINE_MAX)} · ${clipLine(pointer.where, WORD_MAX)}`;
}

/** The pointer in full: the index line, then For, File, a soul's Charter, Invoke and an agent's Runs as. */
function pointerText(pointer: Pointer): string {
  return [
    indexLine(pointer),
    `For: ${clipLine(pointer.purpose || 'no description', PURPOSE_FULL_MAX)}`,
    `File: ${clipLine(pointer.file, PATH_MAX)}`,
    pointer.charter === null ? null : `Charter: ${clipLine(pointer.charter, PATH_MAX)} (the agent file is generated from it; the charter is the one to edit)`,
    `Invoke: ${clipLine(pointer.invoke, PATH_MAX)}`,
    pointer.runsAs === '' ? null : `Runs as: ${clipLine(pointer.runsAs, PATH_MAX)}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

//----------------- lookup_skills ------------

/** `lookup_skills`: the index, one kind of it, one name's pointer in full, or a phrase's fits. */
async function lookupSkills(deps: CompanionToolDeps, args: Args): Promise<ToolTextResult> {
  const scope = args.scope.trim();
  const word = scope.toLowerCase();
  const panel = args.panel === true;
  const said = clipLine(scope, WORD_MAX);
  const index = await readIndex();
  if (index.length === 0) {
    return textResult("The house has no skill or agent on disk: nothing under ~/.claude/skills, ~/.claude/agents, or a project's .claude or .agents folder.");
  }

  // A list answers the lines that fit inline (`fitLines`); `panel: true` puts every line on his panel as a list.
  const list = (title: string, pointers: Pointer[], line: (pointer: Pointer) => string, max: number): ToolTextResult => {
    const lines = pointers.map(line);
    return panel ? toPanel(deps, title, textResult(lines.join('\n')), LIST_ABOUT_NOTHING) : textResult(fitLines(lines, { max }));
  };
  if (word === 'all' || word === 'list') return list('Skills and agents', index, indexLine, index.length);
  if (word === 'skills' || word === 'agents') {
    const kind: Kind = word === 'skills' ? 'skill' : 'agent';
    const ofKind = index.filter((pointer) => pointer.kind === kind);
    if (ofKind.length === 0) return textResult(`The house has no ${word} on disk.`);
    return list(word === 'skills' ? 'Skills' : 'Agents', ofKind, indexLine, ofKind.length);
  }

  const named = word.replace(/^[/$]/, '');
  const exact = index.filter((pointer) => pointer.name.toLowerCase() === named);
  if (exact.length > 0) {
    const text = exact.map(pointerText).join('\n\n');
    return panel ? toPanel(deps, `Skill or agent: ${said}`, textResult(text), NOTE_ABOUT_NOTHING) : textResult(text);
  }

  const words = word.split(/\s+/).filter((part) => part !== '');
  const found = index.filter((pointer) => {
    const hay = `${pointer.name} ${pointer.purpose} ${pointer.where}`.toLowerCase();
    return words.every((part) => hay.includes(part));
  });
  if (found.length === 0) return deps.refuse(`No skill or agent is named "${said}" or says all of those words; fewer words find more, and scope all lists every one.`);
  return list(`Skills and agents: "${said}"`, found, foundLine, LIST_MAX);
}

/**
 * The definition of `lookup_skills`, built with the SDK's `tool()` and zod: read-only, takes `panel`, runs inside
 * `guardedToolResult`, its description her prompt's own line (`toolLine`). Consumed by `tools/companion-tools.ts`
 * (`buildCompanionTools`), after `houseReads`.
 */
export function skillReads(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  const readOnly = { annotations: { readOnlyHint: true } };
  return [
    tool(
      'lookup_skills',
      toolLine('lookup_skills'),
      {
        scope: z
          .string()
          .trim()
          .min(1)
          .max(SCOPE_MAX)
          .describe(
            "all: every skill and agent the house has, one line each, its name, kind and where it lives. skills or agents: one kind of them. An exact name: that one's pointer in full, what it is for, its file and how a session invokes it. Or a few words over their names and purposes."
          ),
        panel: PANEL_FIELD,
      },
      (args) => guardedToolResult('lookup_skills', 'look up the skills and agents', () => lookupSkills(deps, args)),
      readOnly
    ),
  ];
}
