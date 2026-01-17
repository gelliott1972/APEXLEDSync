import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, ExternalLink, Pencil, Trash2, ChevronDown, ChevronRight, Circle, CheckCircle2, Pause, Eye, UserCheck } from 'lucide-react';
import type { ShowSet, StageName, StageStatus } from '@unisync/shared-types';
import { showSetsApi, notesApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { STAGE_PERMISSIONS } from '@unisync/shared-types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { NoteList } from '@/components/notes/NoteList';
import { EditShowSetDialog } from './EditShowSetDialog';

interface ShowSetDetailProps {
  showSet: ShowSet;
  open: boolean;
  onClose: () => void;
  notesOnly?: boolean;
}

const STAGES: StageName[] = [
  'screen',
  'structure',
  'integrated',
  'inBim360',
  'drawing2d',
];

// Valid statuses per stage based on workflow
const STAGE_STATUSES: Record<StageName, StageStatus[]> = {
  screen: ['not_started', 'in_progress', 'complete', 'on_hold'],
  structure: ['not_started', 'in_progress', 'complete', 'on_hold'],
  integrated: ['not_started', 'in_progress', 'engineer_review', 'complete', 'on_hold'],
  inBim360: ['not_started', 'in_progress', 'client_review', 'complete', 'on_hold'],
  drawing2d: ['not_started', 'in_progress', 'engineer_review', 'client_review', 'complete', 'on_hold'],
};

export function ShowSetDetail({ showSet, open, onClose, notesOnly = false }: ShowSetDetailProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [linksExpanded, setLinksExpanded] = useState(false);
  const [stagesExpanded, setStagesExpanded] = useState(!notesOnly);
  const [notesExpanded, setNotesExpanded] = useState(true);

  const { data: notes = [] } = useQuery({
    queryKey: ['notes', showSet.showSetId],
    queryFn: () => notesApi.list(showSet.showSetId),
    enabled: open,
  });

  const updateStageMutation = useMutation({
    mutationFn: ({ stage, status }: { stage: StageName; status: StageStatus }) =>
      showSetsApi.updateStage(showSet.showSetId, stage, { status }),
    onMutate: async ({ stage, status }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['showsets'] });
      // Snapshot previous value
      const previous = queryClient.getQueryData(['showsets']);
      // Optimistically update
      queryClient.setQueryData(['showsets'], (old: ShowSet[] | undefined) =>
        old?.map((s) =>
          s.showSetId === showSet.showSetId
            ? {
                ...s,
                stages: {
                  ...s.stages,
                  [stage]: { ...s.stages[stage], status },
                },
              }
            : s
        )
      );
      return { previous };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(['showsets'], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['showsets'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => showSetsApi.delete(showSet.showSetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['showsets'] });
      onClose();
    },
  });

  const canUpdateStage = (stage: StageName) => {
    if (!user) return false;
    return STAGE_PERMISSIONS[user.role]?.includes(stage) ?? false;
  };

  const canEdit = user?.role === 'admin' || user?.role === 'bim_coordinator';
  const canDelete = user?.role === 'admin';

  const lang = i18n.language as 'en' | 'zh' | 'zh-TW';
  const description = showSet.description[lang] || showSet.description.en;

  if (!open) return null;

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-background border-l shadow-lg z-50 overflow-y-auto">
      <div className="sticky top-0 bg-background border-b px-4 py-2 flex items-center justify-between z-10">
        <h2 className="text-lg font-semibold">{showSet.showSetId}</h2>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button variant="ghost" size="icon" onClick={() => setEditDialogOpen(true)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="icon" onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Basic Info */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">{showSet.showSetId}</span>
            <span className="text-sm text-muted-foreground">{t(`areas.${showSet.area}`)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">{showSet.scene}</span>
            <span className="text-sm text-muted-foreground">{description}</span>
          </div>
        </div>

        {/* VM List */}
        {showSet.vmList.length > 0 && (
          <div className="space-y-1">
            <h3 className="text-sm font-medium">{t('showset.vmList')}</h3>
            <div className="flex flex-wrap gap-2">
              {showSet.vmList.map((vm) => (
                <Badge key={vm.id} variant="outline">
                  {vm.id}
                  {vm.name && ` - ${vm.name}`}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Links */}
        <div className="space-y-1">
          <button
            className="flex items-center gap-1 text-sm font-medium w-full text-left"
            onClick={() => setLinksExpanded(!linksExpanded)}
          >
            {linksExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {t('showset.links')}
          </button>
          {linksExpanded && (
            <div className="space-y-2 pl-5">
              {showSet.links.modelUrl && (
                <a
                  href={showSet.links.modelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  {t('showset.modelUrl')}
                </a>
              )}
              {showSet.links.drawingsUrl && (
                <a
                  href={showSet.links.drawingsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  {t('showset.drawingsUrl')}
                </a>
              )}
              {!showSet.links.modelUrl && !showSet.links.drawingsUrl && (
                <p className="text-sm text-muted-foreground">{t('showset.noLinks')}</p>
              )}
            </div>
          )}
        </div>

        {/* Stages - Workflow View */}
        <div className="space-y-1">
          <button
            className="flex items-center gap-1 text-sm font-medium w-full text-left"
            onClick={() => setStagesExpanded(!stagesExpanded)}
          >
            {stagesExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {t('showset.stages')}
          </button>
          {stagesExpanded && (
            <div className="relative pl-4 pt-2">
              {/* Vertical line */}
              <div className="absolute left-[1.05rem] top-4 bottom-4 w-0.5 bg-muted" />

              {STAGES.map((stage, index) => {
                const stageInfo = showSet.stages[stage];
                const status = stageInfo.status;
                const canEdit = canUpdateStage(stage);
                const isLast = index === STAGES.length - 1;

                // Status icon and color
                const getStatusIcon = () => {
                  switch (status) {
                    case 'complete':
                      return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
                    case 'in_progress':
                      return <Circle className="h-5 w-5 text-orange-500 fill-orange-500" />;
                    case 'engineer_review':
                      return <UserCheck className="h-5 w-5 text-purple-500" />;
                    case 'client_review':
                      return <Eye className="h-5 w-5 text-blue-500" />;
                    case 'on_hold':
                      return <Pause className="h-5 w-5 text-red-500" />;
                    default:
                      return <Circle className="h-5 w-5 text-muted-foreground" />;
                  }
                };

                return (
                  <div
                    key={stage}
                    className={`relative flex items-center gap-3 ${isLast ? '' : 'pb-4'}`}
                  >
                    {/* Status icon */}
                    <div className="relative z-10 bg-background">
                      {getStatusIcon()}
                    </div>

                    {/* Stage name and status selector */}
                    <div className="flex-1 flex items-center justify-between min-w-0">
                      <span className="text-sm font-medium">{t(`stages.${stage}`)}</span>
                      {canEdit ? (
                        <Select
                          value={status}
                          onValueChange={(value) =>
                            updateStageMutation.mutate({
                              stage,
                              status: value as StageStatus,
                            })
                          }
                        >
                          <SelectTrigger className="w-36 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STAGE_STATUSES[stage].map((s) => (
                              <SelectItem key={s} value={s}>
                                {t(`status.${s}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant={status as any} className="text-xs">
                          {t(`status.${status}`)}
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="space-y-1">
          <button
            className="flex items-center gap-1 text-sm font-medium w-full text-left"
            onClick={() => setNotesExpanded(!notesExpanded)}
          >
            {notesExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {t('notes.title')}
          </button>
          {notesExpanded && <NoteList showSetId={showSet.showSetId} notes={notes} />}
        </div>
      </div>
      </div>

      {/* Edit Dialog */}
      <EditShowSetDialog
        showSet={showSet}
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.delete')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('showset.deleteConfirm', { id: showSet.showSetId })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? t('common.loading') : t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
