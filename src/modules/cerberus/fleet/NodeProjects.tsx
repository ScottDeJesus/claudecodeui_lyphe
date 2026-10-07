import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { useProjectChoices } from '@/modules/cerberus/context/ProjectChoicesContext';
import type { CerberusNodeProject, CerberusNodeView, CerberusOverview } from '@/shared/cerberus-types';
import type { CerberusProjectMove, ProjectChoice } from '@/shared/types';
import { ActionMenu, Banner, Button } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** A move still out: the project, and whether it is on its way here or back to this server. */
type Move = { project: CerberusNodeProject; to: 'here' | 'back' };

/**
 * The workspace's projects that run on no node, drawn as the section draws a project (its display name
 * and its folder). A project that any node of the overview lists is on that node, so it is no choice here;
 * `null` when no panel has handed its projects down (a section drawn outside one), which leaves the menu disabled.
 */
function projectsOnNoNode(workspace: ProjectChoice[] | null, overview: CerberusOverview | null): CerberusNodeProject[] | null {
  if (workspace === null) return null;
  const onANode = new Set((overview?.nodes ?? []).flatMap((listed) => listed.projects.map((project) => project.projectId)));
  return workspace
    .filter((project) => !onANode.has(project.projectId))
    .map(({ projectId, displayName, fullPath }) => ({ projectId, name: displayName, path: fullPath }));
}

/**
 * By path, in code-unit order: SQLite's BINARY order, which `projectsDb.listByNode` sorts the
 * overview's list in. A tile drawn before the overview lists it stands where the overview then draws it.
 */
function byPath(a: CerberusNodeProject, b: CerberusNodeProject): number {
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}

type NodeProjectsProps = {
  /** The node, by id: the words name it, and a project picked moves to it. */
  node: string;
  /**
   * Its warden's link, as the overview reads it (`CerberusNodeView.link`). While it is not `reporting`
   * (silent, or never heard), a message in any of these projects is refused, and the section says so.
   */
  link: CerberusNodeView['link'];
  /** The projects that run on it, as the overview lists them (`CerberusNodeView.projects`). */
  projects: CerberusNodeProject[];
  /**
   * `grid` closes an open node card: a canvas band under its services, at their edge. `list` closes a
   * list row's open band, at the indent its service rows keep.
   */
  face: 'grid' | 'list';
};

/**
 * PROJECTS THAT RUN HERE: the projects whose Claude chats a co-located node's warden hosts, and the
 * menu that puts one more there. It follows the node's services on its open card, in both faces, and is
 * drawn only for a node on this machine: no other node can take a project yet.
 *
 * - Each project is a tile, its name over its path (both data, wrapped rather than cut), with ✕ to move
 *   it back to this server. The tiles wrap, so ✕ stays beside its own name at any width. The name is the
 *   sidebar's, as it is in the menu and the toasts, so a project never reads under two.
 * - "Run a project here" opens the projects on no node, by name, each with its path under it, so two
 *   folders of one name read apart. It is the kit's portalled `ActionMenu`, not a `Select`: a node card
 *   clips what overflows it (`overflow-hidden`, in Grid and in List), and a Select's list is drawn in
 *   place. Choosing one IS the move, which is what a menu item is.
 * - While the node's warden is not reporting, a warn banner under the heading leads with what that
 *   costs: "Messages in eis1's projects are refused until its warden reports." It is the one time these
 *   projects cannot run; a move still lands then, and its toast says the same.
 * - With nothing assigned, a dashed line says what assigning does. With nothing left to offer, the
 *   menu gives way to a line saying so; with no list handed down (a section drawn outside a panel), the
 *   menu's trigger stands disabled, so no "nothing left" is said of a list nobody has read.
 * - A move shows on its tile until it answers: a project picked appears at once, dashed, "Moving
 *   here…"; a ✕ pressed reads "Moving back…" and keeps focus, taking no second press (`aria-disabled`,
 *   never `disabled`). Moves answer one by one, so the rest of the section stays live.
 * - When the server refuses a move here (409 `PROJECT_NODE_NOT_COLOCATED`), a warn banner under the
 *   menu says so in words, until the next press. Any other failure is the write's own toast.
 *
 * For Fleet's `NodeCard` (Grid and List) and the rings' `RingsNodePanel`, on a co-located node's open card.
 */
export function NodeProjects({ node, link, projects, face }: NodeProjectsProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const { overview, setProjectNode } = useCerberus();
  // The sidebar's own list, kept live by the workspace; the menu offers the ones no node has.
  const workspace = useProjectChoices();
  const choices = projectsOnNoNode(workspace, overview);
  // A project reads under ONE name wherever it is said: the sidebar's, which the person picked it by and
  // which also reads `package.json`. The overview's name is the custom name or the folder's, and differs
  // for a project with no custom name; it stands only for a project the sidebar does not list (a hidden
  // scratch folder). Naming the tile here is what keeps the picker row, the toast and the tile in step.
  const named = (project: CerberusNodeProject): CerberusNodeProject => {
    const known = workspace?.find((choice) => choice.projectId === project.projectId);
    return known === undefined ? project : { ...project, name: known.displayName };
  };
  // The provider's one verb, pointed here and pointed back: it writes, re-reads the overview, then toasts.
  const onAssign = (project: CerberusNodeProject): Promise<CerberusProjectMove> => setProjectNode(project, node);
  const onUnassign = (project: CerberusNodeProject): Promise<CerberusProjectMove> => setProjectNode(project, null);

  // The moves still out, one per project. Essential: a pick draws its tile before the overview lists
  // it, and a ✕ pressed reads "Moving back…" until its answer; neither is in any read yet.
  const [busy, setBusy] = useState<Move[]>([]);
  // The name of the project the server last refused to move here, shown until the next press.
  // Essential: a refusal is an answer, and no re-read of the overview carries it.
  const [refused, setRefused] = useState<string | null>(null);
  // The project whose move back has landed: once the overview drops its tile, the ✕ that held focus
  // has gone with it, and the heading takes focus rather than the top of the page.
  const leftRef = useRef<string | null>(null);

  useEffect(() => {
    const left = leftRef.current;
    if (left === null || projects.some((listed) => listed.projectId === left)) return;
    leftRef.current = null;
    const heading = headingRef.current;
    const page = heading?.ownerDocument;
    if (heading && page && (page.activeElement === null || page.activeElement === page.body)) heading.focus();
  });

  const movingOf = (projectId: string) => busy.find((entry) => entry.project.projectId === projectId)?.to ?? null;
  const isListed = (projectId: string) => projects.some((listed) => listed.projectId === projectId);

  const move = async (project: CerberusNodeProject, to: Move['to']) => {
    setRefused(null);
    setBusy((moves) => [...moves, { project, to }]);
    const answer = await (to === 'here' ? onAssign(project) : onUnassign(project)).catch((): CerberusProjectMove => 'failed');
    setBusy((moves) => moves.filter((entry) => entry.project.projectId !== project.projectId));
    if (answer === 'refused') setRefused(project.name);
    if (answer === 'moved' && to === 'back') leftRef.current = project.projectId;
  };

  // A project on its way here stands at its place by path until the overview lists it.
  const arriving = busy.flatMap((entry) => (entry.to === 'here' && !isListed(entry.project.projectId) ? [entry.project] : []));
  const tiles = [...projects.map(named), ...arriving].sort(byPath);
  // The menu offers what is neither here nor on its way, by name, then by path.
  const offered = (choices ?? [])
    .filter((choice) => movingOf(choice.projectId) === null && !isListed(choice.projectId))
    .sort((a, b) => a.name.localeCompare(b.name) || byPath(a, b));

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex flex-col gap-2.5 border-t border-border pb-4 pt-3',
        face === 'grid' ? 'bg-background px-4' : 'pl-[clamp(16px,10cqi,60px)] pr-4',
      )}
    >
      <h3 ref={headingRef} id={headingId} tabIndex={-1} className="text-xs uppercase tracking-[.14em] text-muted-foreground">
        {t('cerberus.node.projects.title')}
      </h3>

      {/* Silent, or never heard: the warden line above says how; this says what it costs these projects. */}
      {link !== 'reporting' && <Banner tone="warn">{t('cerberus.node.projects.notReporting', { node })}</Banner>}

      {tiles.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-input px-3.5 py-3 text-[13px] text-muted-foreground">
          <span className="font-medium text-secondary-foreground">{t('cerberus.node.projects.emptyLead')}</span>
          {/* "Pick a project below" while there is one to pick, or may be: with none, the line under the tiles says so. */}
          {(choices === null || offered.length > 0) && <> {t('cerberus.node.projects.emptyMessage', { node })}</>}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {tiles.map((project) => {
            const moving = movingOf(project.projectId);
            const moveBack = t('cerberus.node.projects.moveBack', { name: project.name });
            return (
              <li
                key={project.projectId}
                aria-busy={moving !== null || undefined}
                className={cn(
                  'flex min-w-0 max-w-full flex-[1_1_260px] items-center gap-2 rounded-[10px] border bg-card py-1.5 pl-3.5 pr-1.5 sm:max-w-[420px]',
                  moving === 'here' ? 'border-dashed border-input' : 'border-border',
                )}
              >
                <div className="min-w-0 flex-1 py-1">
                  <p className="text-sm font-medium [overflow-wrap:anywhere]">{project.name}</p>
                  <p className="font-mono text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">{project.path}</p>
                </div>
                {moving === 'here' ? (
                  <span role="status" className="flex-none px-2 text-[12.5px] text-muted-foreground">
                    {t('cerberus.node.projects.movingHere')}
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={moving === null ? moveBack : undefined}
                    title={moving === null ? moveBack : undefined}
                    busy={moving === 'back'}
                    onClick={() => void move(project, 'back')}
                    // Muted ink, not the ghost's accent: moving a project back is a quiet, reversible act, and
                    // the card's green already means "passing".
                    className={cn(
                      'flex-none text-muted-foreground',
                      moving === null ? 'w-9 px-0 hover:text-foreground max-md:size-11' : 'cursor-not-allowed px-2 text-[12.5px]',
                    )}
                  >
                    {moving === null ? <span aria-hidden>✕</span> : t('cerberus.node.projects.movingBack')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {choices !== null && offered.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">{t('cerberus.node.projects.noChoices')}</p>
      ) : (
        <ActionMenu
          label={t('cerberus.node.projects.pick')}
          align="left"
          variant="outline"
          size="sm"
          // Before the workspace's projects are read, the menu stands where it will open, and takes no press.
          disabled={choices === null}
          className="self-start max-sm:w-full"
          triggerClassName="max-sm:w-full max-sm:justify-between max-md:h-11"
          // A list that outgrows the screen scrolls inside the menu; a path wraps rather than widening it.
          menuClassName="w-[min(24rem,calc(100vw-1rem))] max-h-[min(22rem,60dvh)] overflow-y-auto [overflow-wrap:anywhere]"
          items={offered.map((choice) => ({
            key: choice.projectId,
            label: choice.name,
            description: choice.path,
            onSelect: () => void move(choice, 'here'),
          }))}
        />
      )}

      {refused !== null && (
        <div role="alert">
          <Banner tone="warn">
            <span className="font-medium">{t('cerberus.node.projects.refusedLead', { name: refused })}</span>{' '}
            {t('cerberus.node.projects.refused', { node })}
          </Banner>
        </div>
      )}
    </section>
  );
}
