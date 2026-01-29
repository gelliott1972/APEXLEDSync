import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Paperclip, X, FileText, Image, Loader2 } from 'lucide-react';
import type { Issue, Language } from '@unisync/shared-types';
import { issuesApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';

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

interface CreateIssueFormProps {
  showSetId: string;
  parentIssueId?: string;
  onClose: () => void;
  onSuccess?: (issue: Issue) => void;
}

export function CreateIssueForm({
  showSetId,
  parentIssueId,
  onClose,
  onSuccess,
}: CreateIssueFormProps) {
  const { t, i18n } = useTranslation();
  const { user, effectiveRole } = useAuthStore();
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch users for @mention autocomplete
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
    staleTime: 60000,
  });

  const currentRole = effectiveRole();
  const isViewOnly = currentRole === 'view_only';

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'];

    const validFiles = files.filter((file) => {
      if (!allowedTypes.includes(file.type)) {
        alert(t('issues.invalidFileType'));
        return false;
      }
      if (file.size > 50 * 1024 * 1024) {
        alert(t('issues.fileTooLarge'));
        return false;
      }
      return true;
    });

    setSelectedFiles((prev) => [...prev, ...validFiles]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const position = e.target.selectionStart || 0;
    setContent(value);
    setCursorPosition(position);

    // Check for @ mention trigger
    const textBeforeCursor = value.slice(0, position);
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
    if (mentionMatch) {
      setMentionSearch(mentionMatch[1]);
      setShowMentionDropdown(true);
    } else {
      setShowMentionDropdown(false);
    }
  };

  const insertMention = (userName: string) => {
    const textBeforeCursor = content.slice(0, cursorPosition);
    const textAfterCursor = content.slice(cursorPosition);
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
    if (mentionMatch) {
      const newText =
        textBeforeCursor.slice(0, -mentionMatch[0].length) + `@${userName} ` + textAfterCursor;
      setContent(newText);
    }
    setShowMentionDropdown(false);
    textareaRef.current?.focus();
  };

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(mentionSearch.toLowerCase()) && u.userId !== user?.userId
  );

  const createMutation = useMutation({
    mutationFn: () => {
      if (parentIssueId) {
        return issuesApi.createReply(parentIssueId, showSetId, {
          content,
          language: i18n.language as Language,
        });
      }
      return issuesApi.create(showSetId, {
        content,
        language: i18n.language as Language,
      });
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['issues', showSetId] });
      const previousIssues = queryClient.getQueryData<Issue[]>(['issues', showSetId]);

      const lang = normalizeLanguage(i18n.language);
      const optimisticIssue: Issue = {
        issueId: `temp-${Date.now()}`,
        showSetId,
        parentIssueId,
        replyCount: 0,
        authorId: user?.userId || '',
        authorName: user?.name || '',
        originalLang: lang,
        content: {
          en: lang === 'en' ? content : '',
          zh: lang === 'zh' ? content : '',
          'zh-TW': lang === 'zh-TW' ? content : '',
        },
        status: 'open',
        mentions: [],
        participants: [user?.userId || ''],
        unreadFor: [],
        lastReadBy: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        translationStatus: 'pending',
        attachments: [],
      };

      queryClient.setQueryData<Issue[]>(['issues', showSetId], (old) => [
        optimisticIssue,
        ...(old || []),
      ]);

      return { previousIssues };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(['issues', showSetId], context.previousIssues);
      }
    },
    onSuccess: async (newIssue) => {
      if (selectedFiles.length > 0 && newIssue?.issueId) {
        setIsUploading(true);
        try {
          for (const file of selectedFiles) {
            await issuesApi.uploadFile(newIssue.issueId, showSetId, file);
          }
        } catch (error) {
          console.error('File upload failed:', error);
          alert(t('issues.uploadFailed'));
        }
        setIsUploading(false);
      }

      queryClient.invalidateQueries({ queryKey: ['issues', showSetId] });
      queryClient.invalidateQueries({ queryKey: ['my-issues'] });
      setContent('');
      setSelectedFiles([]);
      onClose();
      onSuccess?.(newIssue);
    },
  });

  const isPending = createMutation.isPending || isUploading;

  if (isViewOnly) {
    return null;
  }

  return (
    <div className="p-3 border rounded-lg space-y-3">
      <div className="relative">
        <textarea
          ref={textareaRef}
          className="w-full min-h-[100px] p-2 text-sm border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={parentIssueId ? t('issues.addReply') : t('issues.createIssue')}
          value={content}
          onChange={handleContentChange}
        />

        {/* Mention dropdown */}
        {showMentionDropdown && filteredUsers.length > 0 && (
          <div className="absolute z-10 w-48 bg-popover border rounded-md shadow-md max-h-40 overflow-y-auto">
            {filteredUsers.slice(0, 5).map((u) => (
              <button
                key={u.userId}
                className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => insertMention(u.name)}
              >
                {u.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{t('issues.mentionUser')}</p>

      {/* Selected files display */}
      {selectedFiles.length > 0 && (
        <div className="space-y-1">
          {selectedFiles.map((file, index) => (
            <div
              key={index}
              className="flex items-center gap-2 text-xs bg-muted/50 rounded px-2 py-1"
            >
              {file.type.startsWith('image/') ? (
                <Image className="h-3 w-3" />
              ) : (
                <FileText className="h-3 w-3" />
              )}
              <span className="truncate flex-1">{file.name}</span>
              <span className="text-muted-foreground">{formatFileSize(file.size)}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 p-0"
                onClick={() => removeFile(index)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
            className="hidden"
            multiple
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending}
            title={t('issues.attachFile')}
          >
            <Paperclip className="h-4 w-4 mr-1" />
            {t('issues.attachFile')}
          </Button>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={() => createMutation.mutate()}
            disabled={!content.trim() || isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                {isUploading ? t('issues.uploading') : t('common.loading')}
              </>
            ) : (
              t('common.save')
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
