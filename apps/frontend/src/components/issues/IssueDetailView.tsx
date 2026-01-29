import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { issuesApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { IssueItem } from './IssueItem';
import { CreateIssueForm } from './CreateIssueForm';
import { CloseIssueDialog } from './CloseIssueDialog';

interface IssueDetailViewProps {
  issueId: string;
  showSetId: string;
}

export function IssueDetailView({ issueId, showSetId }: IssueDetailViewProps) {
  const { t } = useTranslation();
  const { user, effectiveRole } = useAuthStore();
  const queryClient = useQueryClient();
  const [isReplying, setIsReplying] = useState(false);
  const [showCloseDialog, setShowCloseDialog] = useState(false);

  const currentRole = effectiveRole();
  const isViewOnly = currentRole === 'view_only';

  const { data, isLoading } = useQuery({
    queryKey: ['issue', issueId, showSetId],
    queryFn: () => issuesApi.get(issueId, showSetId),
    refetchInterval: 30000,
  });

  // Mark issue as read mutation
  const markReadMutation = useMutation({
    mutationFn: () => issuesApi.markRead(issueId, showSetId),
    onSuccess: () => {
      // Refetch my issues to update unread counts
      queryClient.invalidateQueries({ queryKey: ['my-issues'] });
    },
  });

  // Close issue mutation
  const closeIssueMutation = useMutation({
    mutationFn: () => issuesApi.close(issueId, showSetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', issueId, showSetId] });
      queryClient.invalidateQueries({ queryKey: ['my-issues'] });
      queryClient.invalidateQueries({ queryKey: ['issues', showSetId] });
      setShowCloseDialog(false);
    },
  });

  // Mark as read and show close dialog when viewing with replies
  useEffect(() => {
    if (data && user) {
      const { issue, replies } = data;

      // Mark as read
      if (issue.unreadFor?.includes(user.userId)) {
        markReadMutation.mutate();
      }

      // Show close dialog if this is the creator viewing an open issue with replies
      if (
        issue.authorId === user.userId &&
        issue.status === 'open' &&
        replies.length > 0 &&
        issue.unreadFor?.includes(user.userId)
      ) {
        setShowCloseDialog(true);
      }
    }
  }, [data, user, issueId]);

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }

  const { issue, replies } = data;

  const handleCloseIssue = () => {
    closeIssueMutation.mutate();
  };

  return (
    <div className="space-y-4">
      {/* Main issue */}
      <IssueItem issue={issue} showSetId={showSetId} />

      {/* Close Issue Dialog */}
      <CloseIssueDialog
        open={showCloseDialog}
        onClose={() => setShowCloseDialog(false)}
        onConfirm={handleCloseIssue}
      />

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
