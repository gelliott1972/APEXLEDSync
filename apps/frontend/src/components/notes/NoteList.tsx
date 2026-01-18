import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, AlertCircle, Filter, AlertTriangle, Paperclip, Download, X, FileText, Image } from 'lucide-react';
import type { Note, Language, NoteAttachment } from '@unisync/shared-types';
import { notesApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';

interface NoteListProps {
  showSetId: string;
  notes: Note[];
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

// Attachment item component
function AttachmentItem({
  attachment,
  noteId,
  showSetId,
  canDelete,
}: {
  attachment: NoteAttachment;
  noteId: string;
  showSetId: string;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const [isDownloading, setIsDownloading] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => notesApi.deleteAttachment(noteId, attachment.id, showSetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', showSetId] });
    },
  });

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const { downloadUrl } = await notesApi.getAttachment(noteId, attachment.id, showSetId);
      // Open in new tab for PDFs, download for others
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
    <div className="flex items-center gap-2 px-2 py-1 bg-muted/50 rounded text-xs">
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
  );
}

function NoteItem({ note, showSetId }: { note: Note; showSetId: string }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const lang = i18n.language as Language;
  const content = note.content[lang] || note.content[note.originalLang];

  const canEdit = user?.userId === note.authorId;
  const canDelete = user?.role === 'admin' || user?.userId === note.authorId;
  const isRevision = note.isRevisionNote;
  const attachments = note.attachments ?? [];

  const deleteMutation = useMutation({
    mutationFn: () => notesApi.delete(note.noteId, showSetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', showSetId] });
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert(t('notes.invalidFileType'));
      return;
    }

    // Validate file size (50MB)
    if (file.size > 50 * 1024 * 1024) {
      alert(t('notes.fileTooLarge'));
      return;
    }

    setIsUploading(true);
    try {
      await notesApi.uploadFile(note.noteId, showSetId, file);
      queryClient.invalidateQueries({ queryKey: ['notes', showSetId] });
    } catch (error) {
      console.error('Upload failed:', error);
      alert(t('notes.uploadFailed'));
    } finally {
      setIsUploading(false);
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const time = new Date(note.createdAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const isPending = note.translationStatus === 'pending';

  return (
    <div className={`p-2 border rounded-lg space-y-1 ${isPending ? 'animate-pulse bg-muted/50' : ''} ${isRevision ? 'revision-note' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {isRevision && <AlertTriangle className="h-3 w-3 text-amber-500" />}
          <p className="text-xs text-muted-foreground">
            {time} · {note.authorName}
            {isRevision && <span className="ml-1 text-amber-600">({t('status.revision_required')})</span>}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {note.translationStatus === 'failed' && (
            <AlertCircle className="h-3 w-3 text-destructive" />
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
                className="h-5 w-5"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                title={t('notes.attachFile')}
              >
                <Paperclip className="h-3 w-3" />
              </Button>
            </>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm whitespace-pre-wrap">{content}</p>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="space-y-1 pt-1">
          {attachments.map((attachment) => (
            <AttachmentItem
              key={attachment.id}
              attachment={attachment}
              noteId={note.noteId}
              showSetId={showSetId}
              canDelete={canEdit}
            />
          ))}
        </div>
      )}

      {/* Upload progress */}
      {isUploading && (
        <div className="text-xs text-muted-foreground animate-pulse">
          {t('notes.uploading')}
        </div>
      )}
    </div>
  );
}

function AddNoteForm({
  showSetId,
  onClose,
}: {
  showSetId: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      notesApi.create(showSetId, {
        content,
        language: i18n.language as Language,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', showSetId] });
      setContent('');
      onClose();
    },
  });

  return (
    <div className="p-3 border rounded-lg space-y-3">
      <textarea
        className="w-full min-h-[100px] p-2 text-sm border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder={t('notes.addNote')}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          onClick={() => createMutation.mutate()}
          disabled={!content.trim() || createMutation.isPending}
        >
          {createMutation.isPending ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}

export function NoteList({ showSetId, notes }: NoteListProps) {
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [showRevisionOnly, setShowRevisionOnly] = useState(false);

  // Count revision notes
  const revisionNoteCount = notes.filter((n) => n.isRevisionNote).length;

  // Filter notes if needed
  const displayNotes = showRevisionOnly
    ? notes.filter((n) => n.isRevisionNote)
    : notes;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {!isAdding && (
          <Button variant="outline" size="sm" onClick={() => setIsAdding(true)} className="flex-1">
            <Plus className="h-4 w-4 mr-1" />
            {t('notes.addNote')}
          </Button>
        )}
        {revisionNoteCount > 0 && (
          <Button
            variant={showRevisionOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowRevisionOnly(!showRevisionOnly)}
            className="shrink-0"
            title={t('notes.filterRevision')}
          >
            <Filter className="h-4 w-4 mr-1" />
            {revisionNoteCount}
          </Button>
        )}
      </div>

      {isAdding && (
        <AddNoteForm showSetId={showSetId} onClose={() => setIsAdding(false)} />
      )}

      {displayNotes.length === 0 && !isAdding ? (
        <p className="text-sm text-muted-foreground text-center py-2">
          {showRevisionOnly ? t('notes.noRevisionNotes') : t('notes.noNotes')}
        </p>
      ) : (
        <div className="space-y-2">
          {displayNotes.map((note) => (
            <NoteItem key={note.noteId} note={note} showSetId={showSetId} />
          ))}
        </div>
      )}
    </div>
  );
}
