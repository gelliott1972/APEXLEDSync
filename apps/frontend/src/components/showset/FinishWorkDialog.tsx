import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ShowSet, StageName, StageStatus, UserRole } from '@unisync/shared-types';
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

interface FinishWorkDialogProps {
  showSet: ShowSet;
  open: boolean;
  onClose: () => void;
}

// Determine what status a stage should go to when worker finishes
// Workers send stages to review; reviewers approve/reject
function getFinishStatus(
  stage: StageName,
  currentStatus: StageStatus,
  role: UserRole,
  markComplete: boolean
): StageStatus {
  const isReviewer = role === 'engineer' || role === 'admin';

  // If reviewer is finishing a review stage, they approve or keep in progress
  if (isReviewer && (currentStatus === 'engineer_review' || currentStatus === 'client_review')) {
    return markComplete ? 'complete' : currentStatus; // stay in review if not marking complete
  }

  // If not marking as complete, leave as in_progress
  if (!markComplete) {
    return 'in_progress';
  }

  // Worker finishing work - route to appropriate review or complete
  switch (stage) {
    case 'screen':
    case 'structure':
      // These stages go directly to complete
      return 'complete';
    case 'integrated':
      // Integrated goes to engineer review
      return 'engineer_review';
    case 'inBim360':
      // BIM360 goes to client review
      return 'client_review';
    case 'drawing2d':
      // Drawing2d goes to engineer review first, then client review, then complete
      // Check current status to determine next step
      if (currentStatus === 'in_progress' || currentStatus === 'revision_required') {
        return 'engineer_review';
      }
      if (currentStatus === 'engineer_review') {
        return 'client_review';
      }
      if (currentStatus === 'client_review') {
        return 'complete';
      }
      return 'complete';
    default:
      return 'complete';
  }
}

// Get user-friendly description of what will happen when finishing
function getFinishDescription(
  stage: StageName,
  currentStatus: StageStatus,
  role: UserRole,
  t: (key: string) => string
): string {
  const nextStatus = getFinishStatus(stage, currentStatus, role, true);
  if (nextStatus === 'complete') {
    return t('status.complete');
  }
  return t(`status.${nextStatus}`);
}

export function FinishWorkDialog({ showSet, open, onClose }: FinishWorkDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { effectiveRole } = useAuthStore();
  const { workingStages, endSession } = useSessionStore();
  const [stagesToComplete, setStagesToComplete] = useState<StageName[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentRole = effectiveRole();

  const updateStageMutation = useMutation({
    mutationFn: ({ stage, status }: { stage: StageName; status: StageStatus }) =>
      showSetsApi.updateStage(showSet.showSetId, stage, { status }),
  });

  const toggleStage = (stage: StageName) => {
    setStagesToComplete((prev) =>
      prev.includes(stage)
        ? prev.filter((s) => s !== stage)
        : [...prev, stage]
    );
  };

  const handleFinish = async () => {
    if (!currentRole) return;

    setIsSubmitting(true);
    try {
      // Update stages based on what was selected
      for (const stage of workingStages) {
        const currentStatus = showSet.stages[stage].status;
        const markComplete = stagesToComplete.includes(stage);
        const newStatus = getFinishStatus(stage, currentStatus, currentRole, markComplete);

        // Only update if status is changing
        if (newStatus !== currentStatus) {
          await updateStageMutation.mutateAsync({
            stage,
            status: newStatus,
          });
        }
      }

      // End the session
      await endSession();

      queryClient.invalidateQueries({ queryKey: ['showsets'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onClose();
    } catch (error) {
      console.error('Failed to finish work:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setStagesToComplete([]);
      onClose();
    }
  };

  const stageNames = workingStages.map((s) => t(`stages.${s}`)).join(', ');

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sessions.finishWork')}</DialogTitle>
          <DialogDescription>
            {t('sessions.finishWorkDescription', { stages: stageNames })}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-3">
          <p className="text-sm font-medium">{t('sessions.markComplete')}</p>
          {workingStages.map((stage) => {
            const currentStatus = showSet.stages[stage].status;
            const nextStatusDesc = currentRole
              ? getFinishDescription(stage, currentStatus, currentRole, t)
              : '';

            return (
              <div key={stage} className="flex items-center space-x-3">
                <Checkbox
                  id={`complete-${stage}`}
                  checked={stagesToComplete.includes(stage)}
                  onCheckedChange={() => toggleStage(stage)}
                />
                <Label htmlFor={`complete-${stage}`} className="flex-1 flex items-center justify-between cursor-pointer">
                  <span>{t(`stages.${stage}`)}</span>
                  <span className="text-xs text-muted-foreground">
                    → {nextStatusDesc}
                  </span>
                </Label>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleFinish} disabled={isSubmitting}>
            {isSubmitting ? t('common.loading') : t('sessions.finishWork')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
