import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, ExternalLink, Pencil, Trash2, ChevronDown, ChevronRight, Circle, CheckCircle2, Pause, Eye, UserCheck, AlertTriangle, Send, Lock, LockOpen, MessageSquare, Plus } from 'lucide-react';
import type { ShowSet, StageName, StageStatus, StageUpdateInput, Issue } from '@unisync/shared-types';
import { showSetsApi, issuesApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
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
import { IssuesModal, IssueItem, CreateIssueForm } from '@/components/issues';
import { EditShowSetDialog } from './EditShowSetDialog';
import { RequestUpstreamRevisionDialog } from './RequestUpstreamRevisionDialog';

// Helper to check if ShowSet is locked (simple flag - admin controls)
function isShowSetLocked(showSet: ShowSet): boolean {
  return !!showSet.lockedAt;
}

// Check if a downstream stage needs revision, meaning this stage may need rework
// (Duplicated from StartWorkDialog.tsx for use in status display)
function downstreamNeedsRevision(showSet: ShowSet, stage: StageName): boolean {
  switch (stage) {
    case 'screen':
      return showSet.stages.structure.status === 'revision_required' ||
             showSet.stages.inBim360.status === 'revision_required';
    case 'structure':
      // If BIM360 or drawing2d needs revision, structure model may need fixes
      return showSet.stages.inBim360.status === 'revision_required' ||
             showSet.stages.drawing2d.status === 'revision_required';
    case 'inBim360':
      // If drawing2d needs revision, BIM360 may need fixes
      return showSet.stages.drawing2d.status === 'revision_required';
    default:
      return false;
  }
}

interface ShowSetDetailProps {
  showSet: ShowSet;
  open: boolean;
  onClose: () => void;
  notesOnly?: boolean;
}

const STAGES: StageName[] = [
  'screen',
  'structure',
  'inBim360',
  'drawing2d',
];

// Valid statuses per stage based on workflow (admin can set any status)
const STAGE_STATUSES: Record<StageName, StageStatus[]> = {
  screen: ['not_started', 'in_progress', 'revision_required', 'complete', 'on_hold'],
  structure: ['not_started', 'in_progress', 'engineer_review', 'revision_required', 'complete', 'on_hold'],
  inBim360: ['not_started', 'in_progress', 'client_review', 'revision_required', 'complete', 'on_hold'],
  drawing2d: ['not_started', 'in_progress', 'engineer_review', 'client_review', 'revision_required', 'complete', 'on_hold'],
};

// Stage order for unlock dialog
const STAGE_ORDER: StageName[] = ['screen', 'structure', 'inBim360', 'drawing2d'];

// Unlock Dialog component
interface UnlockDialogProps {
  showSet: ShowSet;
  open: boolean;
  onClose: () => void;
  onConfirm: (stagesToReset: StageName[]) => void;
  isLoading: boolean;
}

function UnlockDialog({ showSet, open, onClose, onConfirm, isLoading }: UnlockDialogProps) {
  const { t } = useTranslation();
  const [selectedStages, setSelectedStages] = useState<StageName[]>(() =>
    STAGE_ORDER.filter(stage => showSet.stages[stage].status === 'complete')
  );

  const toggleStage = (stage: StageName) => {
    setSelectedStages(prev =>
      prev.includes(stage)
        ? prev.filter(s => s !== stage)
        : [...prev, stage]
    );
  };

  const handleConfirm = () => {
    onConfirm(selectedStages);
  };

  // Reset selected stages when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedStages(STAGE_ORDER.filter(stage => showSet.stages[stage].status === 'complete'));
    }
  }, [open, showSet]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('showset.unlockTitle', 'Unlock ShowSet')}</DialogTitle>
          <DialogDescription>
            {t('showset.unlockDescription', 'Select which stages need rework. Selected stages will be set to "Revision Required".')}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-3">
          {STAGE_ORDER.map(stage => {
            const stageInfo = showSet.stages[stage];
            const isComplete = stageInfo.status === 'complete';
            return (
              <div key={stage} className="flex items-center space-x-3">
                <Checkbox
                  id={`unlock-${stage}`}
                  checked={selectedStages.includes(stage)}
                  onCheckedChange={() => toggleStage(stage)}
                  disabled={!isComplete}
                />
                <Label htmlFor={`unlock-${stage}`} className="flex-1 flex items-center justify-between cursor-pointer">
                  <span className={!isComplete ? 'text-muted-foreground' : ''}>{t(`stages.${stage}`)}</span>
                  <span className="text-xs text-muted-foreground">{t(`status.${stageInfo.status}`)}</span>
                </Label>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? t('common.loading') : t('showset.unlock', 'Unlock')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ShowSetDetail({ showSet, open, onClose, notesOnly = false }: ShowSetDetailProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { effectiveRole } = useAuthStore();
  const currentRole = effectiveRole();

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [linksExpanded, setLinksExpanded] = useState(false);
  const [stagesExpanded, setStagesExpanded] = useState(!notesOnly);
  const [issuesExpanded, setIssuesExpanded] = useState(true);
  const [issuesModalOpen, setIssuesModalOpen] = useState(false);
  const [isAddingIssue, setIsAddingIssue] = useState(false);

  // Revision dialog state
  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false);
  const [revisionStage, setRevisionStage] = useState<StageName | null>(null);
  const [revisionNote, setRevisionNote] = useState('');

  // Unlock dialog state
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);

  // Upstream revision dialog state
  const [upstreamRevisionDialogOpen, setUpstreamRevisionDialogOpen] = useState(false);
  const [upstreamRevisionCurrentStage, setUpstreamRevisionCurrentStage] = useState<StageName | null>(null);

  const { data: issues = [] } = useQuery({
    queryKey: ['issues', showSet.showSetId],
    queryFn: () => issuesApi.list(showSet.showSetId),
    enabled: open,
    // Poll every 3 seconds while any issue is pending translation
    refetchInterval: (query): number | false => {
      const data = query.state.data as Issue[] | undefined;
      const hasPendingTranslations = data?.some((i: Issue) => i.translationStatus === 'pending');
      return hasPendingTranslations ? 3000 : false;
    },
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
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['showsets'] });
      // Also invalidate issues if setting revision_required (creates an issue)
      if (variables.input.status === 'revision_required') {
        queryClient.invalidateQueries({ queryKey: ['issues', showSet.showSetId] });
      }
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

  // Only admin can change stage status directly in the side panel
  // All other users change status through workflows (StartWorkDialog, FinishWorkDialog, ApprovalDialog)
  const canUpdateStage = (_stage: StageName) => {
    return currentRole === 'admin';
  };

  // Get allowed statuses for a stage (admin only uses this)
  const getAllowedStatuses = (stage: StageName): StageStatus[] => {
    return STAGE_STATUSES[stage];
  };

  const canEditShowSet = currentRole === 'admin' || currentRole === 'bim_coordinator';
  const canDelete = currentRole === 'admin';
  const isAdmin = currentRole === 'admin';
  const isLocked = isShowSetLocked(showSet);

  // Lock mutation
  const lockMutation = useMutation({
    mutationFn: () => showSetsApi.lock(showSet.showSetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['showsets'] });
    },
  });

  // Unlock mutation
  const unlockMutation = useMutation({
    mutationFn: (stagesToReset: StageName[]) => showSetsApi.unlock(showSet.showSetId, stagesToReset),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['showsets'] });
      setUnlockDialogOpen(false);
    },
  });

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
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{showSet.showSetId}</h2>
          {isLocked && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Lock className="h-4 w-4 text-amber-600" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('showset.locked')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            isLocked ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUnlockDialogOpen(true)}
                disabled={unlockMutation.isPending}
              >
                <LockOpen className="h-4 w-4 mr-1" />
                {t('showset.unlock')}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => lockMutation.mutate()}
                disabled={lockMutation.isPending}
              >
                <Lock className="h-4 w-4 mr-1" />
                {t('showset.lock')}
              </Button>
            )
          )}
          {canEditShowSet && (
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
          {/* Version display - 3 deliverables */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pt-1">
            <span>{t('stages.short.screen')}: <span className="font-medium text-foreground">v{showSet.screenVersion ?? 1}</span></span>
            <span>Revit: <span className="font-medium text-foreground">v{showSet.revitVersion ?? Math.max(showSet.structureVersion ?? 1, showSet.integratedVersion ?? 1)}</span></span>
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
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-1 text-sm font-medium text-left"
              onClick={() => setStagesExpanded(!stagesExpanded)}
            >
              {stagesExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {t('showset.stages')}
            </button>
            {currentRole !== 'view_only' && !isLocked && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // Find the first in_progress stage or the first not_started stage
                  const inProgressStage = STAGES.find(s => showSet.stages[s].status === 'in_progress');
                  const revisionStage = STAGES.find(s => showSet.stages[s].status === 'revision_required');
                  const targetStage = inProgressStage || revisionStage || 'screen';
                  setUpstreamRevisionCurrentStage(targetStage);
                  setUpstreamRevisionDialogOpen(true);
                }}
                className="text-xs h-7"
              >
                <AlertTriangle className="h-3 w-3 mr-1" />
                {t('revision.requestUpstream', 'Request Revision')}
              </Button>
            )}
          </div>
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

                // Check if this stage is complete but has downstream rejection
                const needsAttention = status === 'complete' && downstreamNeedsRevision(showSet, stage);

                // Status icon and color
                const getStatusIcon = () => {
                  // Special case: complete but downstream stage has rejection
                  if (needsAttention) {
                    return (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="relative cursor-help">
                              <CheckCircle2 className="h-5 w-5 text-orange-500" />
                              <AlertTriangle className="h-3 w-3 text-orange-600 absolute -top-1 -right-1" />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs needs-attention-tooltip">
                            <p className="font-medium">{t('status.needsAttention', 'Complete but downstream stage needs revision')}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  }

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

        {/* Issues */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-1 text-sm font-medium text-left"
              onClick={() => setIssuesExpanded(!issuesExpanded)}
            >
              {issuesExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <MessageSquare className="h-4 w-4" />
              {t('issues.title')}
              {issues.length > 0 && (
                <span className="text-xs text-muted-foreground ml-1">
                  ({issues.filter(i => i.status === 'open').length} {t('issues.open').toLowerCase()})
                </span>
              )}
            </button>
            {issuesExpanded && (
              <Button variant="ghost" size="sm" onClick={() => setIssuesModalOpen(true)}>
                {t('issues.viewAll')}
              </Button>
            )}
          </div>

          {issuesExpanded && (
            <div className="space-y-2">
              {/* Add Issue button */}
              {currentRole !== 'view_only' && !isAddingIssue && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setIsAddingIssue(true)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {t('issues.createIssue')}
                </Button>
              )}

              {/* Add Issue form */}
              {isAddingIssue && (
                <CreateIssueForm
                  showSetId={showSet.showSetId}
                  onClose={() => setIsAddingIssue(false)}
                />
              )}

              {/* Recent issues (compact view) */}
              {issues.length === 0 && !isAddingIssue ? (
                <p className="text-sm text-muted-foreground text-center py-2">
                  {t('issues.noIssues')}
                </p>
              ) : (
                <div className="space-y-2">
                  {issues.slice(0, 3).map((issue) => (
                    <IssueItem
                      key={issue.issueId}
                      issue={issue}
                      showSetId={showSet.showSetId}
                      onClick={() => setIssuesModalOpen(true)}
                      isCompact
                    />
                  ))}
                  {issues.length > 3 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-muted-foreground"
                      onClick={() => setIssuesModalOpen(true)}
                    >
                      +{issues.length - 3} {t('issues.viewAll').toLowerCase()}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Issues Modal */}
      <IssuesModal
        open={issuesModalOpen}
        onClose={() => setIssuesModalOpen(false)}
        showSetId={showSet.showSetId}
        showSetName={showSet.showSetId}
      />

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

      {/* Unlock Dialog */}
      <UnlockDialog
        showSet={showSet}
        open={unlockDialogOpen}
        onClose={() => setUnlockDialogOpen(false)}
        onConfirm={(stagesToReset) => unlockMutation.mutate(stagesToReset)}
        isLoading={unlockMutation.isPending}
      />

      {/* Request Upstream Revision Dialog */}
      {upstreamRevisionCurrentStage && (
        <RequestUpstreamRevisionDialog
          showSet={showSet}
          currentStage={upstreamRevisionCurrentStage}
          open={upstreamRevisionDialogOpen}
          onClose={() => setUpstreamRevisionDialogOpen(false)}
          onSuccess={() => {
            // Optionally show a success message
          }}
        />
      )}

    </>
  );
}
