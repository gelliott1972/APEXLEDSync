import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, ArrowLeft, Plus, CheckCircle } from 'lucide-react';
import type { Issue } from '@unisync/shared-types';
import { issuesApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { IssueDetailView } from './IssueDetailView';
import { IssueItemCompact } from './IssueItemCompact';
import { CreateIssueForm } from './CreateIssueForm';
import { CloseIssueDialog } from './CloseIssueDialog';

type TabValue = 'open' | 'closed';

interface IssuesModalProps {
  open: boolean;
  onClose: () => void;
  showSetId?: string;
  showSetName?: string;
  initialIssueId?: string;
}

export function IssuesModal({ open, onClose, showSetId, showSetName, initialIssueId }: IssuesModalProps) {
  const { t } = useTranslation();
  const { user, effectiveRole } = useAuthStore();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [activeTab, setActiveTab] = useState<TabValue>('open');
  const [isCreating, setIsCreating] = useState(false);
  const [showCloseDialog, setShowCloseDialog] = useState(false);

  const currentRole = effectiveRole();
  const isViewOnly = currentRole === 'view_only';

  // Reset state when modal opens/closes or showSetId changes
  useEffect(() => {
    if (open) {
      setSelectedIssue(null);
      setActiveTab('open');
      setIsCreating(false);
    }
  }, [open, showSetId]);

  // ShowSet Issues query
  const { data: issues = [], isLoading } = useQuery({
    queryKey: ['issues', showSetId],
    queryFn: () => issuesApi.list(showSetId!),
    enabled: open && !!showSetId,
    refetchInterval: 60000,
  });

  // My Issues query (for unread indicators) - include userId to prevent cross-user caching
  const { data: myIssues } = useQuery({
    queryKey: ['my-issues', user?.userId],
    queryFn: issuesApi.myIssues,
    enabled: open && !!user?.userId,
    refetchInterval: 60000,
  });

  // Auto-select issue when initialIssueId is provided and issues are loaded
  useEffect(() => {
    if (open && initialIssueId && issues.length > 0 && !selectedIssue) {
      const issue = issues.find(i => i.issueId === initialIssueId);
      if (issue) {
        setSelectedIssue(issue);
        setActiveTab(issue.status === 'closed' ? 'closed' : 'open');
      }
    }
  }, [open, initialIssueId, issues, selectedIssue]);

  // Close issue mutation
  const closeMutation = useMutation({
    mutationFn: (comment: string) => {
      if (!selectedIssue) throw new Error('No issue selected');
      return issuesApi.close(selectedIssue.issueId, selectedIssue.showSetId, comment);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', showSetId] });
      queryClient.invalidateQueries({ queryKey: ['issue', selectedIssue?.issueId, showSetId] });
      queryClient.invalidateQueries({ queryKey: ['my-issues'] });
      queryClient.invalidateQueries({ queryKey: ['closed-issues'] });
      setShowCloseDialog(false);
      // Close the entire modal after closing an issue
      onClose();
    },
    onError: (error: Error) => {
      console.error('Close issue error:', error);
      toast({
        variant: 'destructive',
        title: t('issues.closeError', 'Failed to close issue'),
        description: error.message,
      });
    },
  });

  // Check if user can close the selected issue
  const canCloseSelectedIssue = selectedIssue && (
    currentRole === 'admin' || user?.userId === selectedIssue.authorId
  );

  const handleSelectIssue = (issue: Issue) => {
    setSelectedIssue(issue);
    setIsCreating(false);
  };

  const handleBack = () => {
    setSelectedIssue(null);
  };

  const handleClose = () => {
    setSelectedIssue(null);
    setIsCreating(false);
    onClose();
  };

  // Filter issues by status (exclude replies)
  const openIssues = issues.filter(i => i.status === 'open' && !i.parentIssueId);
  const closedIssues = issues.filter(i => i.status === 'closed' && !i.parentIssueId);
  const unreadIssueIds = myIssues?.unreadIssueIds ?? [];

  // Get title
  const title = showSetId && showSetName
    ? t('issues.showSetIssues', { id: showSetName })
    : t('issues.myIssues');

  // Render issue detail view
  const renderDetailView = () => {
    if (!selectedIssue) return null;
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t('issues.backToList')}
          </Button>
          {canCloseSelectedIssue && selectedIssue.status === 'open' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCloseDialog(true)}
              disabled={closeMutation.isPending}
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              {t('issues.markClosed')}
            </Button>
          )}
        </div>
        <IssueDetailView
          issueId={selectedIssue.issueId}
          showSetId={selectedIssue.showSetId}
          onIssueClosed={onClose}
        />
        <CloseIssueDialog
          open={showCloseDialog}
          onClose={() => setShowCloseDialog(false)}
          onConfirm={(comment) => closeMutation.mutate(comment)}
          isLoading={closeMutation.isPending}
        />
      </div>
    );
  };

  // Render issue list
  const renderIssueList = (issueList: Issue[], emptyMessage: string) => {
    if (issueList.length === 0) {
      return (
        <p className="text-sm text-muted-foreground text-center py-8">
          {emptyMessage}
        </p>
      );
    }

    return (
      <div className="space-y-2">
        {issueList.map((issue) => (
          <IssueItemCompact
            key={issue.issueId}
            issue={issue}
            onClick={() => handleSelectIssue(issue)}
            isUnread={unreadIssueIds.includes(issue.issueId)}
          />
        ))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              {title}
            </DialogTitle>
            {showSetId && !selectedIssue && !isCreating && !isViewOnly && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCreating(true)}
                className="mr-6"
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>
        </DialogHeader>

        {selectedIssue ? (
          <div className="flex-1 overflow-y-auto">
            {renderDetailView()}
          </div>
        ) : isCreating && showSetId ? (
          <div className="flex-1 overflow-y-auto">
            <CreateIssueForm
              showSetId={showSetId}
              onClose={() => setIsCreating(false)}
            />
          </div>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(v: string) => setActiveTab(v as TabValue)}
            className="flex-1 flex flex-col min-h-0"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="open">
                {t('issues.open')} ({openIssues.length})
              </TabsTrigger>
              <TabsTrigger value="closed">
                {t('issues.closed')} ({closedIssues.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="open" className="flex-1 overflow-y-auto mt-2">
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  {t('common.loading')}
                </div>
              ) : (
                renderIssueList(openIssues, t('issues.noOpenIssues'))
              )}
            </TabsContent>

            <TabsContent value="closed" className="flex-1 overflow-y-auto mt-2">
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  {t('common.loading')}
                </div>
              ) : (
                renderIssueList(closedIssues, t('issues.noClosedIssues'))
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
