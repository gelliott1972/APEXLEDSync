import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, ExternalLink, Pencil, Trash2, ChevronDown, ChevronRight, Circle, CheckCircle2, Pause, Eye, UserCheck, AlertTriangle, Send } from 'lucide-react';
import type { ShowSet, StageName, StageStatus, StageUpdateInput } from '@unisync/shared-types';
import { showSetsApi, notesApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { STAGE_PERMISSIONS, ENGINEER_ALLOWED_STATUSES } from '@unisync/shared-types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
  integrated: ['not_started', 'in_progress', 'engineer_review', 'revision_required', 'complete', 'on_hold'],
  inBim360: ['not_started', 'in_progress', 'client_review', 'revision_required', 'complete', 'on_hold'],
  drawing2d: ['not_started', 'in_progress', 'engineer_review', 'client_review', 'revision_required', 'complete', 'on_hold'],
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

  // Revision dialog state
  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false);
  const [revisionStage, setRevisionStage] = useState<StageName | null>(null);
  const [revisionNote, setRevisionNote] = useState('');

  const { data: notes = [] } = useQuery({
    queryKey: ['notes', showSet.showSetId],
    queryFn: () => notesApi.list(showSet.showSetId),
    enabled: open,
  });

  const updateStageMutation = useMutation({
    mutationFn: ({ stage, input }: { stage: StageName; input: StageUpdateInput }) =>
      showSetsApi.updateStage(showSet.showSetId, stage, input),
    onMutate: async ({ stage, input }) => {
      // Cancel outgoing refetches for all showsets queries (with or without area filter)
      await queryClient.cancelQueries({ queryKey: ['showsets'], exact: false });

      // Snapshot all showsets queries
      const previousQueries = queryClient.getQueriesData<ShowSet[]>({ queryKey: ['showsets'] });

      // Optimistically update all showsets queries
      queryClient.setQueriesData<ShowSet[]>(
        { queryKey: ['showsets'] },
        (old) =>
          old?.map((s) =>
            s.showSetId === showSet.showSetId
              ? {
                  ...s,
                  stages: {
                    ...s.stages,
                    [stage]: { ...s.stages[stage], status: input.status },
                  },
                }
              : s
          )
      );
      return { previousQueries };
    },
    onError: (_err, _variables, context) => {
      // Rollback all queries on error
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['showsets'] });
    },
  });

  // Handle status change - open revision dialog if revision_required selected
  const handleStatusChange = (stage: StageName, newStatus: StageStatus) => {
    if (newStatus === 'revision_required') {
      setRevisionStage(stage);
      setRevisionNote('');
      setRevisionDialogOpen(true);
    } else {
      updateStageMutation.mutate({ stage, input: { status: newStatus } });
    }
  };

  // Submit revision with note
  const handleRevisionSubmit = () => {
    if (!revisionStage || !revisionNote.trim()) return;

    const lang = i18n.language as 'en' | 'zh' | 'zh-TW';
    updateStageMutation.mutate({
      stage: revisionStage,
      input: {
        status: 'revision_required',
        revisionNote: revisionNote.trim(),
        revisionNoteLang: lang,
      },
    });
    setRevisionDialogOpen(false);
    setRevisionStage(null);
    setRevisionNote('');
  };

  // Cancel revision dialog
  const handleRevisionCancel = () => {
    setRevisionDialogOpen(false);
    setRevisionStage(null);
    setRevisionNote('');
  };

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

  // Get allowed statuses for a stage based on user role
  // Engineers can only approve (complete) or request revision
  const getAllowedStatuses = (stage: StageName): StageStatus[] => {
    const baseStatuses = STAGE_STATUSES[stage];
    if (user?.role === 'engineer') {
      return baseStatuses.filter((s) => ENGINEER_ALLOWED_STATUSES.includes(s));
    }
    return baseStatuses;
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
          {/* Version display */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pt-1">
            <span>{t('stages.short.screen')}: <span className="font-medium text-foreground">v{showSet.screenVersion ?? 1}</span></span>
            <span>{t('stages.short.structure')}: <span className="font-medium text-foreground">v{showSet.structureVersion ?? showSet.revitVersion ?? 1}</span></span>
            <span>{t('stages.short.integrated')}: <span className="font-medium text-foreground">v{showSet.integratedVersion ?? showSet.revitVersion ?? 1}</span></span>
            <span>{t('stages.short.inBim360')}: <span className="font-medium text-foreground">v{showSet.bim360Version ?? showSet.revitVersion ?? 1}</span></span>
            <span>{t('stages.short.drawing2d')}: <span className="font-medium text-foreground">v{showSet.drawingVersion ?? 1}</span></span>
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

                // Format date for tooltip
                const formatDate = (dateStr: string) => {
                  try {
                    return new Date(dateStr).toLocaleString(i18n.language, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    });
                  } catch {
                    return dateStr;
                  }
                };

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
                    case 'revision_required':
                      // Show tooltip with revision note if available
                      if (stageInfo.revisionNote) {
                        return (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertTriangle className="h-5 w-5 text-amber-500 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-xs bg-amber-50 text-amber-900 border-amber-200">
                                <div className="space-y-1">
                                  <p className="font-medium">{stageInfo.revisionNote}</p>
                                  <p className="text-xs opacity-75">
                                    {stageInfo.revisionNoteBy} - {stageInfo.revisionNoteAt && formatDate(stageInfo.revisionNoteAt)}
                                  </p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      }
                      return <AlertTriangle className="h-5 w-5 text-amber-500" />;
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
                          onValueChange={(value) => handleStatusChange(stage, value as StageStatus)}
                        >
                          <SelectTrigger className="w-36 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {getAllowedStatuses(stage).map((s) => (
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

      {/* Revision Required Dialog */}
      <Dialog open={revisionDialogOpen} onOpenChange={(open) => !open && handleRevisionCancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('status.revision_required')}</DialogTitle>
            <DialogDescription>
              {t('revision.description', { stage: revisionStage ? t(`stages.${revisionStage}`) : '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder={t('revision.placeholder')}
              value={revisionNote}
              onChange={(e) => setRevisionNote(e.target.value)}
              rows={4}
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleRevisionCancel}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleRevisionSubmit}
              disabled={!revisionNote.trim() || updateStageMutation.isPending}
            >
              <Send className="h-4 w-4 mr-2" />
              {updateStageMutation.isPending ? t('common.loading') : t('revision.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
