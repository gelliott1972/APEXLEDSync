import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Plus, Filter } from 'lucide-react';
import type { Issue, IssueStatus } from '@unisync/shared-types';
import { issuesApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IssueItem } from './IssueItem';
import { CreateIssueForm } from './CreateIssueForm';

interface IssueListViewProps {
  showSetId: string;
  onSelectIssue: (issue: Issue) => void;
}

export function IssueListView({ showSetId, onSelectIssue }: IssueListViewProps) {
  const { t } = useTranslation();
  const { effectiveRole } = useAuthStore();
  const [isAdding, setIsAdding] = useState(false);
  const [statusFilter, setStatusFilter] = useState<IssueStatus | 'all'>('all');

  const currentRole = effectiveRole();
  const isViewOnly = currentRole === 'view_only';

  const { data: issues = [], isLoading } = useQuery({
    queryKey: ['issues', showSetId],
    queryFn: () => issuesApi.list(showSetId),
    refetchInterval: 60000,
  });

  // Filter issues
  const filteredIssues = issues.filter((issue) => {
    if (statusFilter === 'all') return true;
    return issue.status === statusFilter;
  });

  // Count stats
  const openCount = issues.filter((i) => i.status === 'open').length;
  const closedCount = issues.filter((i) => i.status === 'closed').length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {!isAdding && !isViewOnly && (
          <Button variant="outline" size="sm" onClick={() => setIsAdding(true)} className="flex-1">
            <Plus className="h-4 w-4 mr-1" />
            {t('issues.createIssue')}
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0">
              <Filter className="h-4 w-4 mr-1" />
              {statusFilter === 'all'
                ? t('issues.filterAll')
                : statusFilter === 'open'
                  ? `${t('issues.open')} (${openCount})`
                  : `${t('issues.closed')} (${closedCount})`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setStatusFilter('all')}>
              {t('issues.filterAll')} ({issues.length})
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setStatusFilter('open')}>
              {t('issues.filterOpen')} ({openCount})
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setStatusFilter('closed')}>
              {t('issues.filterClosed')} ({closedCount})
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isAdding && (
        <CreateIssueForm showSetId={showSetId} onClose={() => setIsAdding(false)} />
      )}

      {filteredIssues.length === 0 && !isAdding ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          {t('issues.noIssues')}
        </p>
      ) : (
        <div className="space-y-2">
          {filteredIssues.map((issue) => (
            <IssueItem
              key={issue.issueId}
              issue={issue}
              showSetId={showSetId}
              onClick={() => onSelectIssue(issue)}
              isCompact
            />
          ))}
        </div>
      )}
    </div>
  );
}
