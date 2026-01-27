import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Trash2,
  AlertCircle,
  AlertTriangle,
  Paperclip,
  Download,
  X,
  FileText,
  Image,
  ChevronDown,
  ChevronRight,
  Loader2,
  Languages,
  MessageSquare,
  Lock,
  Unlock,
} from 'lucide-react';
import type { Issue, Language, NoteAttachment } from '@unisync/shared-types';
import { issuesApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { IssueStatusBadge } from './IssueStatusBadge';

// Normalize language to our supported types
function normalizeLanguage(lang: string): Language {
  if (lang === 'zh-TW') return 'zh-TW';
  if (lang.startsWith('zh')) return 'zh';
  return 'en';
}

// Helper to format file sizes
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Helper to get icon for file type
function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) {
    return <Image className="h-3 w-3" />;
  }
  return <FileText className="h-3 w-3" />;
}

// PDF Translation Panel component
function PdfTranslationPanel({ attachment }: { attachment: NoteAttachment }) {
  const { t, i18n } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const currentLang = normalizeLanguage(i18n.language);

  const isPending = attachment.pdfTranslationStatus === 'pending';
  const isFailed = attachment.pdfTranslationStatus === 'failed';
  const isComplete = attachment.pdfTranslationStatus === 'complete';
  const hasTranslation = isComplete && attachment.translatedText;

  if (!attachment.pdfTranslationStatus) return null;

  const translatedText = hasTranslation
    ? attachment.translatedText?.[currentLang] || attachment.extractedText || ''
    : '';

  return (
    <div className="mt-1 border-t pt-1">
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-full"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isPending ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{t('issues.translating')}</span>
          </>
        ) : isFailed ? (
          <>
            <AlertCircle className="h-3 w-3 text-destructive" />
            <span>{attachment.pdfTranslationError || t('issues.translationFailed')}</span>
          </>
        ) : hasTranslation ? (
          <>
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Languages className="h-3 w-3" />
            <span>{t('pdfTranslation.viewTranslation')}</span>
          </>
        ) : (
          <>
            <Languages className="h-3 w-3 text-muted-foreground" />
            <span>{t('pdfTranslation.noTextFound')}</span>
          </>
        )}
      </button>

      {isExpanded && hasTranslation && (
        <div className="mt-2 p-2 bg-muted/30 rounded text-xs max-h-40 overflow-y-auto whitespace-pre-wrap">
          {translatedText}
        </div>
      )}
    </div>
  );
}

// Attachment item component
function AttachmentItem({
  attachment,
  issueId,
  showSetId,
  canDelete,
}: {
  attachment: NoteAttachment;
  issueId: string;
  showSetId: string;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const [isDownloading, setIsDownloading] = useState(false);
  const isPdf = attachment.mimeType === 'application/pdf';

  const deleteMutation = useMutation({
    mutationFn: () => issuesApi.deleteAttachment(issueId, attachment.id, showSetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', showSetId] });
    },
  });

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const { downloadUrl } = await issuesApi.getAttachment(issueId, attachment.id, showSetId);
      if (attachment.mimeType === 'application/pdf') {
        window.open(downloadUrl, '_blank');
      } else {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = attachment.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="px-2 py-1 bg-muted/50 rounded text-xs">
      <div className="flex items-center gap-2">
        {getFileIcon(attachment.mimeType)}
        <span className="truncate flex-1" title={attachment.fileName}>
          {attachment.fileName}
        </span>
        <span className="text-muted-foreground shrink-0">
          {formatFileSize(attachment.fileSize)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={handleDownload}
          disabled={isDownloading}
          title="Download"
        >
          <Download className="h-3 w-3" />
        </Button>
        {canDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            title="Delete"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      {isPdf && <PdfTranslationPanel attachment={attachment} />}
    </div>
  );
}

interface IssueItemProps {
  issue: Issue;
  showSetId: string;
  onClick?: () => void;
  isCompact?: boolean;
  showShowSetId?: boolean; // Show the ShowSet ID in the item (for "My Issues" view)
}

export function IssueItem({ issue, showSetId, onClick, isCompact = false, showShowSetId = false }: IssueItemProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user, effectiveRole } = useAuthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const lang = i18n.language as Language;
  const content = issue.content[lang] || issue.content[issue.originalLang];

  const canEdit = user?.userId === issue.authorId;
  const canDelete = effectiveRole() === 'admin' || user?.userId === issue.authorId;
  const canClose = effectiveRole() === 'admin' || user?.userId === issue.authorId;
  const isRevision = issue.isRevisionNote;
  const attachments = issue.attachments ?? [];

  const deleteMutation = useMutation({
    mutationFn: () => issuesApi.delete(issue.issueId, showSetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', showSetId] });
      queryClient.invalidateQueries({ queryKey: ['my-issues'] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => issuesApi.close(issue.issueId, showSetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', showSetId] });
      queryClient.invalidateQueries({ queryKey: ['my-issues'] });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: () => issuesApi.reopen(issue.issueId, showSetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', showSetId] });
      queryClient.invalidateQueries({ queryKey: ['my-issues'] });
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert(t('issues.invalidFileType'));
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      alert(t('issues.fileTooLarge'));
      return;
    }

    setIsUploading(true);
    try {
      await issuesApi.uploadFile(issue.issueId, showSetId, file);
      queryClient.invalidateQueries({ queryKey: ['issues', showSetId] });
    } catch (error) {
      console.error('Upload failed:', error);
      alert(t('issues.uploadFailed'));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const time = new Date(issue.createdAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const isPending = issue.translationStatus === 'pending';

  if (isCompact) {
    return (
      <div
        className={`p-2 border rounded-lg cursor-pointer hover:bg-accent/50 transition-colors ${
          issue.status === 'closed' ? 'opacity-60' : ''
        }`}
        onClick={onClick}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <IssueStatusBadge status={issue.status} />
            {isRevision && <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />}
            <span className="text-sm truncate">{content}</span>
          </div>
          {issue.replyCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              <MessageSquare className="h-3 w-3" />
              {issue.replyCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
          {showShowSetId && (
            <>
              <span className="font-medium text-foreground">{issue.showSetId}</span>
              <span>·</span>
            </>
          )}
          <span>{time}</span>
          <span>·</span>
          <span>{issue.authorName}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`p-3 border rounded-lg space-y-2 ${isPending ? 'animate-pulse bg-muted/50' : ''} ${
        isRevision ? 'revision-note' : ''
      } ${issue.status === 'closed' ? 'opacity-75' : ''}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IssueStatusBadge status={issue.status} />
          {isRevision && <AlertTriangle className="h-3 w-3 text-amber-500" />}
          <p className="text-xs text-muted-foreground">
            {time} · {issue.authorName}
            {isRevision && (
              <span className="ml-1 text-amber-600">({t('status.revision_required')})</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {issue.translationStatus === 'failed' && (
            <AlertCircle className="h-3 w-3 text-destructive" />
          )}
          {issue.replyCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground mr-2">
              <MessageSquare className="h-3 w-3" />
              {issue.replyCount}
            </span>
          )}
          {canClose && (
            <>
              {issue.status === 'open' ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => closeMutation.mutate()}
                  disabled={closeMutation.isPending}
                  title={t('issues.close')}
                >
                  <Lock className="h-3 w-3" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => reopenMutation.mutate()}
                  disabled={reopenMutation.isPending}
                  title={t('issues.reopen')}
                >
                  <Unlock className="h-3 w-3" />
                </Button>
              )}
            </>
          )}
          {canEdit && (
            <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
                className="hidden"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                title={t('issues.attachFile')}
              >
                <Paperclip className="h-3 w-3" />
              </Button>
            </>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      <p className="text-sm whitespace-pre-wrap">{content}</p>

      {/* Mentions */}
      {issue.mentions && issue.mentions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {issue.mentions.map((mention) => (
            <span
              key={mention.userId}
              className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded"
            >
              @{mention.userName}
            </span>
          ))}
        </div>
      )}

      {/* Closed info */}
      {issue.status === 'closed' && issue.closedByName && (
        <p className="text-xs text-muted-foreground">
          {t('issues.closedBy', { name: issue.closedByName })}
        </p>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="space-y-1 pt-1">
          {attachments.map((attachment) => (
            <AttachmentItem
              key={attachment.id}
              attachment={attachment}
              issueId={issue.issueId}
              showSetId={showSetId}
              canDelete={canEdit}
            />
          ))}
        </div>
      )}

      {isUploading && (
        <div className="text-xs text-muted-foreground animate-pulse">{t('issues.uploading')}</div>
      )}
    </div>
  );
}
