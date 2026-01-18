import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ShowSet, StageName, StageStatus } from '@unisync/shared-types';
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

export function StartWorkDialog({ showSet, open, onClose }: StartWorkDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { startSession } = useSessionStore();
  const [selectedStages, setSelectedStages] = useState<StageName[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get stages the user can work on (has permission and not complete)
  const availableStages = useMemo(() => {
    if (!user) return [];
    const userStages = STAGE_PERMISSIONS[user.role] || [];
    return STAGES_ORDER.filter((stage) => {
      const stageInfo = showSet.stages[stage];
      // Can work on if: has permission AND not complete AND not on_hold
      return (
        userStages.includes(stage) &&
        stageInfo.status !== 'complete' &&
        stageInfo.status !== 'on_hold'
      );
    });
  }, [user, showSet]);

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
      // Set all selected stages to in_progress if they're not_started or revision_required
      for (const stage of selectedStages) {
        const status = showSet.stages[stage].status;
        if (status === 'not_started' || status === 'revision_required') {
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

        <div className="py-4 space-y-3">
          {availableStages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('sessions.noAvailableStages')}
            </p>
          ) : (
            availableStages.map((stage) => {
              const stageInfo = showSet.stages[stage];
              const statusLabel = t(`status.${stageInfo.status}`);
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleStart}
            disabled={selectedStages.length === 0 || isSubmitting}
          >
            {isSubmitting ? t('common.loading') : t('sessions.startSession')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
