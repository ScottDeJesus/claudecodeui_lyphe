import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Chip, Input } from '@/shared/ui';
import type { PrdFile, TaskBoardSortField, TaskBoardSortOrder, TaskBoardView } from '@/shared/types';
import TaskFiltersPanel from '@/modules/task-master/TaskFiltersPanel';
import TaskQuickSortBar from '@/modules/task-master/TaskQuickSortBar';

type TaskBoardToolbarProps = {
  hasProject: boolean;
  hasTaskMasterConfigured: boolean;
  totalTaskCount: number;
  filteredTaskCount: number;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  viewMode: TaskBoardView;
  onViewModeChange: (viewMode: TaskBoardView) => void;
  showFilters: boolean;
  onToggleFilters: () => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  priorityFilter: string;
  onPriorityFilterChange: (priority: string) => void;
  sortField: TaskBoardSortField;
  sortOrder: TaskBoardSortOrder;
  onSortChange: (field: TaskBoardSortField) => void;
  onSortConfigChange: (field: TaskBoardSortField, order: TaskBoardSortOrder) => void;
  statuses: string[];
  priorities: string[];
  onClearFilters: () => void;
  existingPrds: PrdFile[];
  onCreatePrd: () => void;
  onOpenPrd: (prd: PrdFile) => void;
  onOpenHelp: () => void;
  onOpenCreateTask: () => void;
};

const VIEW_MODES: TaskBoardView[] = ['kanban', 'list', 'grid'];

/** Rendered by TaskBoard for the board's search box, view switch, filter toggle and create/help actions. */
export default function TaskBoardToolbar({
  hasProject,
  hasTaskMasterConfigured,
  totalTaskCount,
  filteredTaskCount,
  searchTerm,
  onSearchTermChange,
  viewMode,
  onViewModeChange,
  showFilters,
  onToggleFilters,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  sortField,
  sortOrder,
  onSortChange,
  onSortConfigChange,
  statuses,
  priorities,
  onClearFilters,
  existingPrds,
  onCreatePrd,
  onOpenPrd,
  onOpenHelp,
  onOpenCreateTask,
}: TaskBoardToolbarProps) {
  const { t } = useTranslation('tasks');
  // Whether the list of this project's requirement documents is open. It is a disclosure the
  // reader controls, so it cannot be derived from the documents themselves.
  const [isPrdDropdownOpen, setIsPrdDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsPrdDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Input
          type="text"
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          className="max-w-md lg:flex-1"
        />

        <div className="flex flex-wrap items-center gap-2">
          {VIEW_MODES.map((mode) => (
            <Chip key={mode} size="sm" selected={viewMode === mode} onClick={() => onViewModeChange(mode)}>
              {t(`views.${mode}`)}
            </Chip>
          ))}

          <Chip size="sm" selected={showFilters} onClick={onToggleFilters}>
            {t('filters.button')}
          </Chip>

          {hasProject && (
            <>
              <Button variant="outline" size="sm" onClick={onOpenHelp}>
                {t('buttons.help')}
              </Button>

              <div ref={dropdownRef} className="relative">
                {existingPrds.length > 0 ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-expanded={isPrdDropdownOpen}
                      onClick={() => setIsPrdDropdownOpen((current) => !current)}
                    >
                      {t('buttons.prdsAvailable', { count: existingPrds.length })}
                    </Button>

                    {isPrdDropdownOpen && (
                      <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-lg border border-border bg-popover p-1.5 shadow-xl">
                        <button
                          type="button"
                          onClick={() => {
                            onCreatePrd();
                            setIsPrdDropdownOpen(false);
                          }}
                          className="flex w-full items-center rounded px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-secondary"
                        >
                          {t('buttons.createNewPRD')}
                        </button>

                        <div className="my-1 border-t border-border" />

                        {existingPrds.map((prd) => (
                          <button
                            key={prd.name}
                            type="button"
                            onClick={() => {
                              onOpenPrd(prd);
                              setIsPrdDropdownOpen(false);
                            }}
                            className="flex w-full items-center rounded px-3 py-2 text-left text-sm text-foreground hover:bg-secondary"
                          >
                            <span className="truncate">{prd.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <Button variant="outline" size="sm" onClick={onCreatePrd}>
                    {t('buttons.addPRD')}
                  </Button>
                )}
              </div>

              {(hasTaskMasterConfigured || totalTaskCount > 0) && (
                <Button size="sm" onClick={onOpenCreateTask}>
                  {t('buttons.addTask')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <TaskFiltersPanel
        showFilters={showFilters}
        statusFilter={statusFilter}
        onStatusFilterChange={onStatusFilterChange}
        priorityFilter={priorityFilter}
        onPriorityFilterChange={onPriorityFilterChange}
        sortField={sortField}
        sortOrder={sortOrder}
        onSortConfigChange={onSortConfigChange}
        statuses={statuses}
        priorities={priorities}
        filteredTaskCount={filteredTaskCount}
        totalTaskCount={totalTaskCount}
        onClearFilters={onClearFilters}
      />

      <TaskQuickSortBar sortField={sortField} sortOrder={sortOrder} onSortChange={onSortChange} />
    </>
  );
}
