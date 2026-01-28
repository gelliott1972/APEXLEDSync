import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { issuesApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { IssueItem } from './IssueItem';
import { CreateIssueForm } from './CreateIssueForm';

interface IssueDetailViewProps {
  issueId: string;
  showSetId: string;
}

export function IssueDetailView({ issueId, showSetId }: IssueDetailViewProps) {
  const { t } = useTranslation();
  const { effectiveRole } = useAuthStore();
  const [isReplying, setIsReplying] = useState(false);

  const currentRole = effectiveRole();
  const isViewOnly = currentRole === 'view_only';

  const { data, isLoading } = useQuery({
    queryKey: ['issue', issueId, showSetId],
    queryFn: () => issuesApi.get(issueId, showSetId),
    refetchInterval: 30000,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }

  const { issue, replies } = data;

  return (
    <div className="space-y-4">
      {/* Main issue */}
      <IssueItem issue={issue} showSetId={showSetId} />

      {/* Replies section */}
      <div className="pl-4 border-l-2 border-muted space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            {replies.length > 0
              ? t('issues.replies', { count: replies.length })
              : t('issues.noReplies')}
          </h3>
          {!isViewOnly && !isReplying && (
            <Button variant="outline" size="sm" onClick={() => setIsReplying(true)}>
              <Plus className="h-4 w-4 mr-1" />
              {t('issues.addReply')}
            </Button>
          )}
        </div>

        {isReplying && (
          <CreateIssueForm
            showSetId={showSetId}
            parentIssueId={issueId}
            onClose={() => setIsReplying(false)}
          />
        )}

        {replies.length > 0 && (
          <div className="space-y-2">
            {replies.map((reply) => (
              <IssueItem key={reply.issueId} issue={reply} showSetId={showSetId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
