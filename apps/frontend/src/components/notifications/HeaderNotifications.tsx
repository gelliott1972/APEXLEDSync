import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, MessageSquareText, AtSign } from 'lucide-react';
import type { Issue, MyIssuesResponse } from '@unisync/shared-types';
import { issuesApi } from '@/lib/api';
import { useUIStore } from '@/stores/ui-store';
import { useToast } from '@/hooks/use-toast';
import { NotificationBox } from './NotificationBox';
import { IssuesModal } from '@/components/issues/IssuesModal';

interface HeaderNotificationsProps {
  myIssues: MyIssuesResponse | undefined;
}

export function HeaderNotifications({ myIssues }: HeaderNotificationsProps) {
  const { t } = useTranslation();
  const { setSelectedShowSetId } = useUIStore();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Modal state for navigating to specific issue
  const [modalOpen, setModalOpen] = useState(false);
  const [modalShowSetId, setModalShowSetId] = useState<string | undefined>();
  const [modalIssueId, setModalIssueId] = useState<string | undefined>();

  // Close issue mutation
  const closeMutation = useMutation({
    mutationFn: ({ issueId, showSetId, comment }: { issueId: string; showSetId: string; comment: string }) =>
      issuesApi.close(issueId, showSetId, comment),
    onSuccess: (_, { showSetId }) => {
      queryClient.invalidateQueries({ queryKey: ['issues', showSetId] });
      queryClient.invalidateQueries({ queryKey: ['my-issues'] });
      queryClient.invalidateQueries({ queryKey: ['closed-issues'] });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: t('issues.closeError'),
        description: error.message,
      });
    },
  });

  // Derive the three categories
  const createdByMe = myIssues?.createdByMe ?? [];
  const mentionedIn = myIssues?.mentionedIn ?? [];
  const unreadIssueIds = myIssues?.unreadIssueIds ?? [];

  // My Issues - open issues I created
  const myIssuesOpen = createdByMe.filter(i => i.status === 'open');

  // New Replies - my open issues with unread content
  const newRepliesIssues = myIssuesOpen.filter(i => unreadIssueIds.includes(i.issueId));

  // Tagged - open issues I'm mentioned in (exclude ones I created to avoid duplicates with "My Issues")
  const myIssueIds = new Set(myIssuesOpen.map(i => i.issueId));
  const taggedIssues = mentionedIn.filter(i =>
    i.status === 'open' && !myIssueIds.has(i.issueId)
  );

  const handleIssueClick = (issue: Issue) => {
    // Navigate to dashboard if not already there
    if (location.pathname !== '/') {
      navigate('/');
    }
    // Set the selected ShowSet
    setSelectedShowSetId(issue.showSetId);
    // Open the modal with this issue pre-selected
    setModalShowSetId(issue.showSetId);
    setModalIssueId(issue.issueId);
    setModalOpen(true);
  };

  const handleCloseIssue = async (issueId: string, showSetId: string, comment: string) => {
    await closeMutation.mutateAsync({ issueId, showSetId, comment });
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setModalShowSetId(undefined);
    setModalIssueId(undefined);
  };

  return (
    <>
      <div className="flex items-center gap-0.5">
        <NotificationBox
          label={t('issues.myIssues')}
          count={myIssuesOpen.length}
          icon={FileText}
          issues={myIssuesOpen}
          unreadIssueIds={unreadIssueIds}
          onIssueClick={handleIssueClick}
          onCloseIssue={handleCloseIssue}
          emptyMessage={t('issues.noOpenIssues')}
        />
        <NotificationBox
          label={t('notifications.newReplies', 'Replies')}
          count={newRepliesIssues.length}
          icon={MessageSquareText}
          issues={newRepliesIssues}
          unreadIssueIds={unreadIssueIds}
          onIssueClick={handleIssueClick}
          onCloseIssue={handleCloseIssue}
          emptyMessage={t('notifications.noNewReplies', 'No new replies')}
        />
        <NotificationBox
          label={t('notifications.tagged', 'Tagged')}
          count={taggedIssues.length}
          icon={AtSign}
          issues={taggedIssues}
          unreadIssueIds={unreadIssueIds}
          onIssueClick={handleIssueClick}
          onCloseIssue={handleCloseIssue}
          emptyMessage={t('notifications.noTagged', 'No issues you\'re tagged in')}
        />
      </div>

      {/* Issues Modal for navigation */}
      <IssuesModal
        open={modalOpen}
        onClose={handleModalClose}
        showSetId={modalShowSetId}
        showSetName={modalShowSetId}
        initialIssueId={modalIssueId}
      />
    </>
  );
}
