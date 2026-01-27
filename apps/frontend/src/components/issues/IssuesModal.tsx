import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, ArrowLeft } from 'lucide-react';
import type { Issue } from '@unisync/shared-types';
import { issuesApi } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { IssueListView } from './IssueListView';
import { IssueDetailView } from './IssueDetailView';
import { IssueItem } from './IssueItem';

type TabValue = 'showset' | 'created' | 'mentioned';

interface IssuesModalProps {
  open: boolean;
  onClose: () => void;
  showSetId?: string; // If provided, shows ShowSet tab first
  showSetName?: string;
}

export function IssuesModal({ open, onClose, showSetId, showSetName }: IssuesModalProps) {
  const { t } = useTranslation();
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  // Default to 'showset' tab if showSetId provided, otherwise 'created'
  const [activeTab, setActiveTab] = useState<TabValue>(showSetId ? 'showset' : 'created');

  // Reset state when modal opens/closes or showSetId changes
  useEffect(() => {
    if (open) {
      setSelectedIssue(null);
      setActiveTab(showSetId ? 'showset' : 'created');
    }
  }, [open, showSetId]);

  // My Issues query (for created/mentioned tabs)
  const { data: myIssues } = useQuery({
    queryKey: ['my-issues'],
    queryFn: issuesApi.myIssues,
    enabled: open,
    refetchInterval: 60000,
  });

  // ShowSet Issues query (for showset tab)
  const { data: showSetIssues = [] } = useQuery({
    queryKey: ['issues', showSetId],
    queryFn: () => issuesApi.list(showSetId!),
    enabled: open && !!showSetId,
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

  // Get title based on context
  const getTitle = () => {
    if (showSetId && showSetName) {
      return t('issues.showSetIssues', { id: showSetName });
    }
    return t('issues.myIssues');
  };

  // Render issue detail view
  const renderDetailView = () => {
    if (!selectedIssue) return null;
    return (
      <div className="flex flex-col h-full">
        <Button
          variant="ghost"
          size="sm"
          className="self-start mb-2"
          onClick={handleBack}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          {t('issues.backToList')}
        </Button>
        <IssueDetailView
          issueId={selectedIssue.issueId}
          showSetId={selectedIssue.showSetId}
          onBack={handleBack}
        />
      </div>
    );
  };

  // Render issue list for a given array
  const renderIssueList = (issues: Issue[] | undefined, emptyMessage: string) => {
    if (selectedIssue) {
      return renderDetailView();
    }

    if (!issues?.length) {
      return (
        <p className="text-sm text-muted-foreground text-center py-8">
          {emptyMessage}
        </p>
      );
    }

    return (
      <div className="space-y-2">
        {issues.map((issue) => (
          <IssueItem
            key={issue.issueId}
            issue={issue}
            showSetId={issue.showSetId}
            onClick={() => handleSelectIssue(issue)}
            isCompact
            showShowSetId={activeTab !== 'showset'} // Show ShowSet ID on created/mentioned tabs
          />
        ))}
      </div>
    );
  };

  const openShowSetCount = showSetIssues.filter(i => i.status === 'open' && !i.parentIssueId).length;
  const createdByMeFiltered = myIssues?.createdByMe?.filter(i => !i.parentIssueId) ?? [];
  const mentionedInFiltered = myIssues?.mentionedIn?.filter(i => !i.parentIssueId) ?? [];

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            {getTitle()}
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v: string) => {
            setActiveTab(v as TabValue);
            setSelectedIssue(null); // Reset selection when changing tabs
          }}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className={showSetId ? 'grid w-full grid-cols-3' : 'grid w-full grid-cols-2'}>
            {showSetId && (
              <TabsTrigger value="showset">
                {t('issues.allIssues')}{' '}
                {openShowSetCount > 0 && `(${openShowSetCount})`}
              </TabsTrigger>
            )}
            <TabsTrigger value="created">
              {t('issues.createdByMe')}{' '}
              {createdByMeFiltered.length > 0 && `(${createdByMeFiltered.length})`}
            </TabsTrigger>
            <TabsTrigger value="mentioned">
              {t('issues.mentionedIn')}{' '}
              {mentionedInFiltered.length > 0 && `(${mentionedInFiltered.length})`}
            </TabsTrigger>
          </TabsList>

          {showSetId && (
            <TabsContent value="showset" className="flex-1 overflow-y-auto mt-4">
              {selectedIssue ? (
                renderDetailView()
              ) : (
                <IssueListView showSetId={showSetId} onSelectIssue={handleSelectIssue} />
              )}
            </TabsContent>
          )}

          <TabsContent value="created" className="flex-1 overflow-y-auto mt-4">
            {renderIssueList(createdByMeFiltered, t('issues.noIssues'))}
          </TabsContent>

          <TabsContent value="mentioned" className="flex-1 overflow-y-auto mt-4">
            {renderIssueList(mentionedInFiltered, t('issues.noIssues'))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
