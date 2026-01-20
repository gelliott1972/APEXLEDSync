import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import type { ShowSet, StageName, StageStatus, UserRole } from '@unisync/shared-types';
import { STAGE_PERMISSIONS } from '@unisync/shared-types';
import { showSetsApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// Helper to check if ShowSet is locked (simple flag - admin controls)
function isShowSetLocked(showSet: ShowSet): boolean {
  return !!showSet.lockedAt;
}

interface StartWorkDialogProps {
  showSet: ShowSet;
  open: boolean;
  onClose: () => void;
}

const STAGES_ORDER: StageName[] = [
  'screen',
  'structure',
  'integrated',
  'inBim360',
  'drawing2d',
];

// Workers (3d_modeller, 2d_drafter, bim_coordinator) can work on: not_started, in_progress, revision_required
// Reviewers (engineer, admin) can also approve review states
const WORKABLE_STATUSES_WORKER: StageStatus[] = ['not_started', 'in_progress', 'revision_required'];
const WORKABLE_STATUSES_REVIEWER: StageStatus[] = ['not_started', 'in_progress', 'revision_required', 'engineer_review', 'client_review'];

function canWorkOnStatus(status: StageStatus, role: UserRole): boolean {
  if (role === 'engineer' || role === 'admin') {
    return WORKABLE_STATUSES_REVIEWER.includes(status);
  }
  return WORKABLE_STATUSES_WORKER.includes(status);
}

// Check if a downstream stage needs revision, meaning this stage may need rework
function downstreamNeedsRevision(showSet: ShowSet, stage: StageName): boolean {
  switch (stage) {
    case 'screen':
      return showSet.stages.structure.status === 'revision_required';
    case 'structure':
      return showSet.stages.integrated.status === 'revision_required' ||
             showSet.stages.inBim360.status === 'revision_required';
    case 'integrated':
      // If BIM360 or drawing2d needs revision, integrated model may need fixes
      return showSet.stages.inBim360.status === 'revision_required' ||
             showSet.stages.drawing2d.status === 'revision_required';
    default:
      return false;
  }
}

export function StartWorkDialog({ showSet, open, onClose }: StartWorkDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { effectiveRole } = useAuthStore();
  const { startSession } = useSessionStore();
  const [selectedStages, setSelectedStages] = useState<StageName[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentRole = effectiveRole();

  // Get stages the user can work on (has permission, correct status, not on_hold)
  const availableStages = useMemo(() => {
    if (!currentRole) return [];
    const userStages = STAGE_PERMISSIONS[currentRole] || [];
    return STAGES_ORDER.filter((stage) => {
      const stageInfo = showSet.stages[stage];

      // Must have permission for this stage
      if (!userStages.includes(stage)) return false;

      // Can't work on stages that are on_hold
      if (stageInfo.status === 'on_hold') return false;

      // If stage is complete but downstream needs revision, allow rework
      if (stageInfo.status === 'complete' && downstreamNeedsRevision(showSet, stage)) {
        return true;
      }

      // Otherwise check if status is workable for this role
      return stageInfo.status !== 'complete' && canWorkOnStatus(stageInfo.status, currentRole);
    });
  }, [currentRole, showSet]);

  // Pre-select first available stage by default when dialog opens
  useState(() => {
    if (availableStages.length > 0 && selectedStages.length === 0) {
      setSelectedStages([availableStages[0]]);
    }
  });

  const updateStageMutation = useMutation({
    mutationFn: ({ stage, status }: { stage: StageName; status: StageStatus }) =>
      showSetsApi.updateStage(showSet.showSetId, stage, { status }),
  });

  const toggleStage = (stage: StageName) => {
    setSelectedStages((prev) =>
      prev.includes(stage)
        ? prev.filter((s) => s !== stage)
        : [...prev, stage]
    );
  };

  const handleStart = async () => {
    if (selectedStages.length === 0) return;

    setIsSubmitting(true);
    try {
      // Set all selected stages to in_progress
      // Backend handles version auto-increment when going from complete/revision_required -> in_progress
      for (const stage of selectedStages) {
        const status = showSet.stages[stage].status;
        const isDownstreamRejection = status === 'complete' && downstreamNeedsRevision(showSet, stage);

        // Start work if: not_started, revision_required, or complete (for rework due to downstream rejection)
        if (status === 'not_started' || status === 'revision_required' || isDownstreamRejection) {
          await updateStageMutation.mutateAsync({
            stage,
            status: 'in_progress',
          });
        }
      }

      // Start session with selected stages
      const stageNames = selectedStages.map((s) => t(`stages.${s}`)).join(' + ');
      await startSession(
        showSet.showSetId,
        selectedStages,
        `Working on ${showSet.showSetId}: ${stageNames}`
      );

      queryClient.invalidateQueries({ queryKey: ['showsets'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onClose();
    } catch (error) {
      console.error('Failed to start work:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedStages([]);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sessions.startSession')}</DialogTitle>
          <DialogDescription>
            {t('sessions.selectStages', { id: showSet.showSetId })}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Locked ShowSet message */}
          {isShowSetLocked(showSet) && (
            <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
              <Lock className="h-5 w-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium">{t('showset.lockedMessage')}</p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {isShowSetLocked(showSet) ? (
              <p className="text-sm text-muted-foreground">
                {t('sessions.noAvailableStages')}
              </p>
            ) : availableStages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('sessions.noAvailableStages')}
              </p>
            ) : (
              availableStages.map((stage) => {
                const stageInfo = showSet.stages[stage];
                // Show "Needs Rework" if complete but downstream rejected
                const needsRework = stageInfo.status === 'complete' && downstreamNeedsRevision(showSet, stage);
                const statusLabel = needsRework
                  ? t('status.revision_required')
                  : t(`status.${stageInfo.status}`);
                return (
                  <div key={stage} className="flex items-center space-x-3">
                    <Checkbox
                      id={stage}
                      checked={selectedStages.includes(stage)}
                      onCheckedChange={() => toggleStage(stage)}
                    />
                    <Label
                      htmlFor={stage}
                      className="flex-1 flex items-center justify-between cursor-pointer"
                    >
                      <span className="font-medium">{t(`stages.${stage}`)}</span>
                      <span className="text-xs text-muted-foreground">
                        {statusLabel}
                      </span>
                    </Label>
                  </div>
                );
              })
            )}
          </div>

        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleStart}
            disabled={selectedStages.length === 0 || isSubmitting || isShowSetLocked(showSet)}
          >
            {isSubmitting ? t('common.loading') : t('sessions.startSession')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
