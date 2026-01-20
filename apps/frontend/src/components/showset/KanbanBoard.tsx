import { useTranslation } from 'react-i18next';
import { Lock, Unlock } from 'lucide-react';
import type { ShowSet, StageStatus, StageName } from '@unisync/shared-types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Helper to check if ShowSet is locked
function isShowSetLocked(showSet: ShowSet): boolean {
  return showSet.stages.drawing2d.status === 'complete' && !showSet.unlockedAt;
}

// Helper to check if ShowSet is unlocked for revision
function isShowSetUnlocked(showSet: ShowSet): boolean {
  return !!showSet.unlockedAt;
}

interface KanbanBoardProps {
  showSets: ShowSet[];
  onSelect: (id: string) => void;
}

const STAGES: StageName[] = ['screen', 'structure', 'integrated', 'inBim360', 'drawing2d'];

// Column names include stages + completed
type ColumnName = StageName | 'completed';
const COLUMNS: ColumnName[] = ['screen', 'structure', 'integrated', 'inBim360', 'drawing2d', 'completed'];

// Status display order within each stage
const STATUS_ORDER: StageStatus[] = ['not_started', 'in_progress', 'engineer_review', 'client_review', 'revision_required', 'complete', 'on_hold'];

// Valid statuses to show per column (active + complete for stages, only complete for completed column)
// Note: Only Screen has 'not_started' - other stages start at 'in_progress'
const COLUMN_STATUSES: Record<ColumnName, StageStatus[]> = {
  screen: ['not_started', 'in_progress', 'complete', 'on_hold'],
  structure: ['in_progress', 'complete', 'on_hold'],
  integrated: ['in_progress', 'engineer_review', 'revision_required', 'complete', 'on_hold'],
  inBim360: ['in_progress', 'client_review', 'revision_required', 'complete', 'on_hold'],
  drawing2d: ['in_progress', 'engineer_review', 'client_review', 'revision_required', 'complete', 'on_hold'],
  completed: ['complete'],
};

const columnColors: Record<ColumnName, string> = {
  screen: 'border-t-sky-400',
  structure: 'border-t-violet-400',
  integrated: 'border-t-amber-400',
  inBim360: 'border-t-teal-400',
  drawing2d: 'border-t-rose-400',
  completed: 'border-t-emerald-500',
};

const statusColors: Record<StageStatus, string> = {
  not_started: 'bg-slate-500/30 dark:bg-slate-500/40',
  in_progress: 'bg-orange-500/30 dark:bg-orange-500/40',
  engineer_review: 'bg-purple-500/30 dark:bg-purple-500/40',
  client_review: 'bg-blue-500/30 dark:bg-blue-500/40',
  revision_required: 'bg-amber-500/30 dark:bg-amber-500/40',
  complete: 'bg-emerald-500/30 dark:bg-emerald-500/40',
  on_hold: 'bg-red-500/30 dark:bg-red-500/40',
};

// Check if a ShowSet is fully complete (all stages done)
function isFullyComplete(showSet: ShowSet): boolean {
  return STAGES.every(stage => showSet.stages[stage].status === 'complete');
}

// Get active stages for a ShowSet (can be multiple for parallel stages)
function getActiveStages(showSet: ShowSet): StageName[] {
  // Sequential stages: screen, structure
  if (showSet.stages.screen.status !== 'complete') {
    return ['screen'];
  }
  if (showSet.stages.structure.status !== 'complete') {
    return ['structure'];
  }

  // Integration - can be parallel with BIM360/2D when in engineer_review
  const integratedStatus = showSet.stages.integrated.status;
  if (integratedStatus !== 'complete' && integratedStatus !== 'engineer_review') {
    return ['integrated'];
  }

  // At this point, integrated is either in engineer_review or complete
  // BIM360 and 2D can be active in parallel
  const stages: StageName[] = [];

  if (integratedStatus === 'engineer_review') {
    stages.push('integrated');
  }

  if (showSet.stages.inBim360.status !== 'complete') {
    stages.push('inBim360');
  }

  if (showSet.stages.drawing2d.status !== 'complete') {
    stages.push('drawing2d');
  }

  return stages;
}

// Group showsets by columns, showing completed stages + active stages
function groupByColumnAndStatus(showSets: ShowSet[]): Record<ColumnName, Record<StageStatus, ShowSet[]>> {
  const groups = {} as Record<ColumnName, Record<StageStatus, ShowSet[]>>;

  // Initialize all groups
  for (const column of COLUMNS) {
    groups[column] = {
      not_started: [],
      in_progress: [],
      engineer_review: [],
      client_review: [],
      revision_required: [],
      complete: [],
      on_hold: [],
    };
  }

  for (const showSet of showSets) {
    // Fully complete items go only to the Completed column
    if (isFullyComplete(showSet)) {
      groups['completed']['complete'].push(showSet);
      continue;
    }

    // For in-progress items: show in completed stages + active stages
    for (const stage of STAGES) {
      const status = showSet.stages[stage].status;

      if (status === 'complete') {
        // Show in this stage's complete section
        groups[stage]['complete'].push(showSet);
      } else {
        // Check if this is an active stage for this showSet
        const activeStages = getActiveStages(showSet);
        if (activeStages.includes(stage)) {
          groups[stage][status].push(showSet);
        }
      }
    }
  }

  return groups;
}

const cardColors: Record<StageStatus, string> = {
  not_started: 'bg-slate-500/30 border-slate-500/50 hover:border-slate-400',
  in_progress: 'bg-orange-500/30 border-orange-500/50 hover:border-orange-400',
  engineer_review: 'bg-purple-500/30 border-purple-500/50 hover:border-purple-400',
  client_review: 'bg-blue-500/30 border-blue-500/50 hover:border-blue-400',
  revision_required: 'bg-amber-500/30 border-amber-500/50 hover:border-amber-400',
  complete: 'bg-emerald-500/30 border-emerald-500/50 hover:border-emerald-400',
  on_hold: 'bg-red-500/30 border-red-500/50 hover:border-red-400',
};

// Get the highest relevant version for display (3 deliverables)
function getDisplayVersion(showSet: ShowSet): number {
  const revitVersion = showSet.revitVersion ?? Math.max(showSet.structureVersion ?? 1, showSet.integratedVersion ?? 1);
  return Math.max(
    showSet.screenVersion ?? 1,
    revitVersion,
    showSet.drawingVersion ?? 1
  );
}

function KanbanCard({
  showSet,
  status,
  onClick,
}: {
  showSet: ShowSet;
  status: StageStatus;
  onClick: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'en' | 'zh' | 'zh-TW';
  const description = showSet.description[lang] || showSet.description.en;
  const displayVersion = getDisplayVersion(showSet);

  // Strip "SS-" prefix for compact display
  const compactId = showSet.showSetId.replace(/^SS-/, '');

  return (
    <div
      className={cn(
        'group relative px-1.5 py-1 rounded border cursor-pointer transition-colors',
        cardColors[status]
      )}
      onClick={onClick}
    >
      {/* ID and version on same line when space allows, wraps on narrow */}
      <div className="text-sm font-medium kanban-text flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0">
        <span className="flex items-center gap-1 whitespace-nowrap">
          {compactId}
          {isShowSetLocked(showSet) && <Lock className="h-3 w-3 text-amber-600" />}
          {isShowSetUnlocked(showSet) && <Unlock className="h-3 w-3 text-emerald-600" />}
        </span>
        <span className="text-xs opacity-70 whitespace-nowrap">v{displayVersion}</span>
      </div>

      {/* Hover tooltip with version details */}
      <div className="absolute left-full top-0 ml-1 z-50 hidden group-hover:block w-48 p-2 bg-popover border rounded-lg shadow-lg overflow-hidden">
        <div className="text-xs space-y-1">
          <div className="font-medium">{showSet.showSetId}</div>
          <div className="text-muted-foreground">{showSet.scene}</div>
          <div className="text-muted-foreground truncate">{description}</div>
          <div className="pt-1 border-t mt-1 space-y-0.5">
            <div className="flex justify-between">
              <span>{t('stages.screen')}:</span>
              <span className="font-medium">v{showSet.screenVersion ?? 1}</span>
            </div>
            <div className="flex justify-between">
              <span>Revit:</span>
              <span className="font-medium">v{showSet.revitVersion ?? Math.max(showSet.structureVersion ?? 1, showSet.integratedVersion ?? 1)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('stages.drawing2d')}:</span>
              <span className="font-medium">v{showSet.drawingVersion ?? 1}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusGroup({
  column,
  status,
  showSets,
  onSelect,
  t,
}: {
  column: ColumnName;
  status: StageStatus;
  showSets: ShowSet[];
  onSelect: (id: string) => void;
  t: (key: string) => string;
}) {
  // Don't show status groups that aren't valid for this column
  if (!COLUMN_STATUSES[column].includes(status)) {
    return null;
  }

  // Don't show empty groups
  if (showSets.length === 0) {
    return null;
  }

  return (
    <div className="mb-1.5">
      <div className={cn('text-[10px] uppercase font-semibold px-1 py-0.5 rounded mb-1 inline-block', statusColors[status])}>
        <span className="kanban-text">{t(`status.${status}`)} ({showSets.length})</span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {showSets.map((showSet) => (
          <KanbanCard
            key={showSet.showSetId}
            showSet={showSet}
            status={status}
            onClick={() => onSelect(showSet.showSetId)}
          />
        ))}
      </div>
    </div>
  );
}

export function KanbanBoard({ showSets, onSelect }: KanbanBoardProps) {
  const { t } = useTranslation();
  const grouped = groupByColumnAndStatus(showSets);

  // Count total items per column
  const columnCounts = COLUMNS.reduce((acc, column) => {
    acc[column] = Object.values(grouped[column]).reduce((sum, arr) => sum + arr.length, 0);
    return acc;
  }, {} as Record<ColumnName, number>);

  // Get column title
  const getColumnTitle = (column: ColumnName) => {
    if (column === 'completed') {
      return t('status.complete');
    }
    return t(`stages.${column}`);
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto scrollbar-thin">
      {/* min-width ensures columns don't shrink so much that IDs wrap */}
      <div className="min-w-[680px]">
        {/* Column Headers - sticky at top */}
        <div className="grid grid-cols-6 gap-1.5 mb-1.5 sticky top-0 z-10">
          {COLUMNS.map((column) => (
            <div
              key={column}
              className={cn(
                'kanban-column px-2 py-1.5 rounded-t-lg border border-b-0 border-t-4 bg-muted/50 text-center',
                columnColors[column]
              )}
            >
              <div className="font-medium text-sm whitespace-nowrap">{getColumnTitle(column)}</div>
              <Badge variant="secondary" className="text-xs mt-1">
                {columnCounts[column]}
              </Badge>
            </div>
          ))}
        </div>

        {/* Columns */}
        <div className="grid grid-cols-6 gap-1.5">
          {COLUMNS.map((column) => (
            <div
              key={column}
              className="kanban-column rounded-b-lg border bg-muted/20 p-1.5"
            >
              {STATUS_ORDER.map((status) => (
                <StatusGroup
                  key={status}
                  column={column}
                  status={status}
                  showSets={grouped[column][status]}
                  onSelect={onSelect}
                  t={t}
                />
              ))}
              {columnCounts[column] === 0 && (
                <div className="text-xs text-muted-foreground text-center py-4">
                  —
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
