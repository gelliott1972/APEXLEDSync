import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import type { Note, Language } from '@unisync/shared-types';
import { notesApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';

interface NoteListProps {
  showSetId: string;
  notes: Note[];
}

function NoteItem({ note, showSetId }: { note: Note; showSetId: string }) {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const lang = i18n.language as Language;
  const content = note.content[lang] || note.content[note.originalLang];

  const canDelete = user?.role === 'admin' || user?.userId === note.authorId;

  const deleteMutation = useMutation({
    mutationFn: () => notesApi.delete(note.noteId, showSetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', showSetId] });
    },
  });

  const time = new Date(note.createdAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const isPending = note.translationStatus === 'pending';

  return (
    <div className={`p-2 border rounded-lg space-y-1 ${isPending ? 'animate-pulse bg-muted/50' : ''}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {time} · {note.authorName}
        </p>
        <div className="flex items-center gap-1">
          {note.translationStatus === 'failed' && (
            <AlertCircle className="h-3 w-3 text-destructive" />
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

  return (
    <div className="space-y-2">
      {!isAdding && (
        <Button variant="outline" size="sm" onClick={() => setIsAdding(true)} className="w-full">
          <Plus className="h-4 w-4 mr-1" />
          {t('notes.addNote')}
        </Button>
      )}

      {isAdding && (
        <AddNoteForm showSetId={showSetId} onClose={() => setIsAdding(false)} />
      )}

      {notes.length === 0 && !isAdding ? (
        <p className="text-sm text-muted-foreground text-center py-2">
          {t('notes.noNotes')}
        </p>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <NoteItem key={note.noteId} note={note} showSetId={showSetId} />
          ))}
        </div>
      )}
    </div>
  );
}
