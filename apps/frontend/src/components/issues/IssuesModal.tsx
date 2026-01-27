import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import type { Issue } from '@unisync/shared-types';
import { issuesApi } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { IssueListView } from './IssueListView';
import { IssueDetailView } from './IssueDetailView';
import { IssueItem } from './IssueItem';

interface IssuesModalProps {
  open: boolean;
  onClose: () => void;
  showSetId?: string; // If provided, scoped to ShowSet; otherwise shows "My Issues"
  showSetName?: string;
}

export function IssuesModal({ open, onClose, showSetId, showSetName }: IssuesModalProps) {
  const { t } = useTranslation();
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [activeTab, setActiveTab] = useState<'created' | 'mentioned'>('created');

  // My Issues query (when not scoped to ShowSet)
  const { data: myIssues } = useQuery({
    queryKey: ['my-issues'],
    queryFn: issuesApi.myIssues,
    enabled: open && !showSetId,
    refetchInterval: 60000,
  });

  const handleSelectIssue = (issue: Issue) => {
    setSelectedIssue(issue);
  };

  const handleBack = () => {
    setSelectedIssue(null);
  };

  const handleClose = () => {
    setSelectedIssue(null);
    onClose();
  };

  // ShowSet-scoped view
  if (showSetId) {
    return (
      <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              {showSetName
                ? t('issues.showSetIssues', { id: showSetName })
                : t('issues.title')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            {selectedIssue ? (
              <IssueDetailView
                issueId={selectedIssue.issueId}
                showSetId={showSetId}
                onBack={handleBack}
              />
            ) : (
              <IssueListView showSetId={showSetId} onSelectIssue={handleSelectIssue} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // My Issues view (global)
  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            {t('issues.myIssues')}
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v: string) => setActiveTab(v as 'created' | 'mentioned')}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="created">
              {t('issues.createdByMe')}{' '}
              {myIssues?.createdByMe?.length ? `(${myIssues.createdByMe.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="mentioned">
              {t('issues.mentionedIn')}{' '}
              {myIssues?.mentionedIn?.length ? `(${myIssues.mentionedIn.length})` : ''}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="created" className="flex-1 overflow-y-auto mt-4">
            {selectedIssue ? (
              <IssueDetailView
                issueId={selectedIssue.issueId}
                showSetId={selectedIssue.showSetId}
                onBack={handleBack}
              />
            ) : myIssues?.createdByMe?.length ? (
              <div className="space-y-2">
                {myIssues.createdByMe.map((issue) => (
                  <IssueItem
                    key={issue.issueId}
                    issue={issue}
                    showSetId={issue.showSetId}
                    onClick={() => handleSelectIssue(issue)}
                    isCompact
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('issues.noIssues')}
              </p>
            )}
          </TabsContent>

          <TabsContent value="mentioned" className="flex-1 overflow-y-auto mt-4">
            {selectedIssue ? (
              <IssueDetailView
                issueId={selectedIssue.issueId}
                showSetId={selectedIssue.showSetId}
                onBack={handleBack}
              />
            ) : myIssues?.mentionedIn?.length ? (
              <div className="space-y-2">
                {myIssues.mentionedIn.map((issue) => (
                  <IssueItem
                    key={issue.issueId}
                    issue={issue}
                    showSetId={issue.showSetId}
                    onClick={() => handleSelectIssue(issue)}
                    isCompact
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('issues.noIssues')}
              </p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
