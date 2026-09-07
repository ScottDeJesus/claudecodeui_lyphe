import { useTranslation } from 'react-i18next';

import { Chip } from '@/shared/ui';
import type { TaskBoardSortField, TaskBoardSortOrder } from '@/shared/types';

type TaskQuickSortBarProps = {
  sortField: TaskBoardSortField;
  sortOrder: TaskBoardSortOrder;
  onSortChange: (field: TaskBoardSortField) => void;
};

const QUICK_SORT_FIELDS: TaskBoardSortField[] = ['id', 'status', 'priority'];

/** Rendered by TaskBoardToolbar to switch the board's sort field and direction from a single row of chips. */
export default function TaskQuickSortBar({ sortField, sortOrder, onSortChange }: TaskQuickSortBarProps) {
  const { t } = useTranslation('tasks');

  return (
    <div className="flex flex-wrap gap-2">
      {QUICK_SORT_FIELDS.map((field) => (
        <Chip key={field} size="sm" selected={sortField === field} onClick={() => onSortChange(field)}>
          {/* The arrow belongs to the chosen chip alone: on the others it would claim a
              direction the board is not sorted in. */}
          {t(`sort.${field}`)}
          {sortField === field && <span aria-hidden="true">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
        </Chip>
      ))}
    </div>
  );
}
