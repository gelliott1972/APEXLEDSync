import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Issue } from '@unisync/shared-types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IssueItemCompact } from '@/components/issues/IssueItemCompact';
import { QuickClosePopover } from './QuickClosePopover';
import { cn } from '@/lib/utils';

interface NotificationBoxProps {
  label: string;
  count: number;
  icon: LucideIcon;
  issues: Issue[];
  unreadIssueIds: string[];
  onIssueClick: (issue: Issue) => void;
  onCloseIssue: (issueId: string, showSetId: string, comment: string) => Promise<void>;
  emptyMessage: string;
}

export function NotificationBox({
  label,
  count,
  icon: Icon,
  issues,
  unreadIssueIds,
  onIssueClick,
  onCloseIssue,
  emptyMessage,
}: NotificationBoxProps) {
  const [open, setOpen] = useState(false);
  const [closingIssue, setClosingIssue] = useState<Issue | null>(null);

  const handleIssueClick = (issue: Issue) => {
    setOpen(false);
    onIssueClick(issue);
  };

  const handleQuickClose = async (comment: string) => {
    if (!closingIssue) return;
    await onCloseIssue(closingIssue.issueId, closingIssue.showSetId, comment);
    setClosingIssue(null);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-8 gap-1.5 px-2.5 relative',
            count > 0 && 'text-foreground',
            count === 0 && 'text-muted-foreground'
          )}
        >
          <Icon className="h-4 w-4" />
          <span className="hidden sm:inline text-xs font-medium">{label}</span>
          {count > 0 && (
            <span className="min-w-5 h-5 px-1.5 text-[11px] font-semibold bg-destructive text-destructive-foreground rounded-full flex items-center justify-center">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-h-96 overflow-y-auto p-2">
        {issues.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <div className="space-y-1">
            {issues.map((issue) => (
              <div key={issue.issueId} className="group relative">
                <IssueItemCompact
                  issue={issue}
                  isUnread={unreadIssueIds.includes(issue.issueId)}
                  showShowSetId
                  onClick={() => handleIssueClick(issue)}
                />
                {/* Quick close button on hover */}
                {issue.status === 'open' && (
                  <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <QuickClosePopover
                      issue={issue}
                      onClose={handleQuickClose}
                      isOpen={closingIssue?.issueId === issue.issueId}
                      onOpenChange={(isOpen) => setClosingIssue(isOpen ? issue : null)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
