import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ShowSet, StageName, StageStatus } from '@unisync/shared-types';
import { showSetsApi } from '@/lib/api';
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

export function FinishWorkDialog({ showSet, open, onClose }: FinishWorkDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { workingStages, endSession } = useSessionStore();
  const [stagesToComplete, setStagesToComplete] = useState<StageName[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    setIsSubmitting(true);
    try {
      // Mark selected stages as complete
      for (const stage of stagesToComplete) {
        await updateStageMutation.mutateAsync({
          stage,
          status: 'complete',
        });
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
          {workingStages.map((stage) => (
            <div key={stage} className="flex items-center space-x-3">
              <Checkbox
                id={`complete-${stage}`}
                checked={stagesToComplete.includes(stage)}
                onCheckedChange={() => toggleStage(stage)}
              />
              <Label htmlFor={`complete-${stage}`} className="cursor-pointer">
                {t(`stages.${stage}`)}
              </Label>
            </div>
          ))}
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
