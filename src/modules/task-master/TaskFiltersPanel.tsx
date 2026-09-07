import { useTranslation } from 'react-i18next';

import { Button, Field, Select } from '@/shared/ui';
import type { TaskBoardSortField, TaskBoardSortOrder } from '@/shared/types';

type TaskFiltersPanelProps = {
  showFilters: boolean;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  priorityFilter: string;
  onPriorityFilterChange: (priority: string) => void;
  sortField: TaskBoardSortField;
  sortOrder: TaskBoardSortOrder;
  onSortConfigChange: (field: TaskBoardSortField, order: TaskBoardSortOrder) => void;
  statuses: string[];
  priorities: string[];
  filteredTaskCount: number;
  totalTaskCount: number;
  onClearFilters: () => void;
};

const SORT_CHOICES: `${TaskBoardSortField}-${TaskBoardSortOrder}`[] = [
  'id-asc',
  'id-desc',
  'title-asc',
  'title-desc',
  'status-asc',
  'status-desc',
  'priority-asc',
  'priority-desc',
];

/** The i18n key for one sort choice: `id-asc` is spelled `sort.idAsc`. */
function sortChoiceKey(choice: string): string {
  const [field, order] = choice.split('-');
  return `sort.${field}${order === 'asc' ? 'Asc' : 'Desc'}`;
}

/** Rendered by TaskBoardToolbar as the expandable status/priority filter and sort panel. */
export default function TaskFiltersPanel({
  showFilters,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  sortField,
  sortOrder,
  onSortConfigChange,
  statuses,
  priorities,
  filteredTaskCount,
  totalTaskCount,
  onClearFilters,
}: TaskFiltersPanelProps) {
  const { t } = useTranslation('tasks');

  if (!showFilters) {
    return null;
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-secondary p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('filters.status')}>
          <Select
            ariaLabel={t('filters.status')}
            value={statusFilter}
            onChange={onStatusFilterChange}
            options={[
              { value: 'all', label: t('filters.allStatuses') },
              ...statuses.map((status) => ({ value: status, label: t(`statuses.${status}`, status) })),
            ]}
          />
        </Field>

        <Field label={t('filters.priority')}>
          <Select
            ariaLabel={t('filters.priority')}
            value={priorityFilter}
            onChange={onPriorityFilterChange}
            options={[
              { value: 'all', label: t('filters.allPriorities') },
              ...priorities.map((priority) => ({ value: priority, label: t(`priorities.${priority}`, priority) })),
            ]}
          />
        </Field>

        <Field label={t('filters.sortBy')}>
          <Select
            ariaLabel={t('filters.sortBy')}
            value={`${sortField}-${sortOrder}`}
            onChange={(choice) => {
              const [field, order] = choice.split('-') as [TaskBoardSortField, TaskBoardSortOrder];
              onSortConfigChange(field, order);
            }}
            options={SORT_CHOICES.map((choice) => ({ value: choice, label: t(sortChoiceKey(choice)) }))}
          />
        </Field>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {t('filters.showing', { filtered: filteredTaskCount, total: totalTaskCount })}
        </span>

        <Button variant="link" size="sm" onClick={onClearFilters}>
          {t('filters.clearFilters')}
        </Button>
      </div>
    </div>
  );
}
