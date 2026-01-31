import { useTranslation } from 'react-i18next';
import { Paperclip, MessageSquare, AlertTriangle } from 'lucide-react';
import type { Issue, Language } from '@unisync/shared-types';

interface IssueItemCompactProps {
  issue: Issue;
  onClick?: () => void;
  isUnread?: boolean;
  showShowSetId?: boolean;
}

export function IssueItemCompact({
  issue,
  onClick,
  isUnread = false,
  showShowSetId = false,
}: IssueItemCompactProps) {
  const { i18n } = useTranslation();

  const lang = i18n.language as Language;
  const content = issue.content[lang] || issue.content[issue.originalLang];

  // Format date compactly
  const date = new Date(issue.createdAt);
  const formattedDate = date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });

  const attachmentCount = issue.attachments?.length ?? 0;
  const mentionCount = issue.mentions?.length ?? 0;
  const isRevision = issue.isRevisionNote;

  return (
    <div
      className={`px-3 py-2 rounded-md cursor-pointer hover:bg-accent/50 transition-colors border border-border ${
        isRevision ? 'revision-note' : ''
      }`}
      onClick={onClick}
    >
      {/* Line 1: Issue text with revision indicator */}
      <div className="flex items-start gap-2">
        {isUnread && (
          <span className="h-2 w-2 mt-1.5 rounded-full bg-blue-500 shrink-0" />
        )}
        {isRevision && (
          <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
        )}
        <span className="text-sm leading-snug line-clamp-2">{content}</span>
      </div>

      {/* Line 2: Metadata */}
      <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground ml-0">
        {showShowSetId && (
          <>
            <span className="font-medium text-foreground">{issue.showSetId}</span>
            <span>·</span>
          </>
        )}
        <span>{issue.authorName}</span>
        <span>·</span>
        <span>{formattedDate}</span>

        {/* Indicators pushed to right */}
        <span className="flex-1" />

        {mentionCount > 0 && (
          <span className="flex items-center gap-0.5" title={`${mentionCount} mention${mentionCount > 1 ? 's' : ''}`}>
            @{mentionCount}
          </span>
        )}
        {attachmentCount > 0 && (
          <span className="flex items-center gap-0.5" title={`${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''}`}>
            <Paperclip className="h-3 w-3" />
            {attachmentCount > 1 && attachmentCount}
          </span>
        )}
        {issue.replyCount > 0 && (
          <span className="flex items-center gap-0.5" title={`${issue.replyCount} repl${issue.replyCount > 1 ? 'ies' : 'y'}`}>
            <MessageSquare className="h-3 w-3" />
            {issue.replyCount}
          </span>
        )}
      </div>
    </div>
  );
}
