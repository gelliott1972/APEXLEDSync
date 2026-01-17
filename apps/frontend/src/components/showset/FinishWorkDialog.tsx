import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ShowSet, StageName } from '@unisync/shared-types';
import { showSetsApi } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
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

interface FinishWorkDialogProps {
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

// Get the current (first non-complete) stage
function getCurrentStage(showSet: ShowSet): StageName {
  for (const stage of STAGES_ORDER) {
    if (showSet.stages[stage].status !== 'complete') {
      return stage;
    }
  }
  return 'drawing2d';
}

// Get the next stage after the current one
function getNextStage(currentStage: StageName): StageName | null {
  const idx = STAGES_ORDER.indexOf(currentStage);
  if (idx === -1 || idx >= STAGES_ORDER.length - 1) {
    return null;
  }
  return STAGES_ORDER[idx + 1];
}

export function FinishWorkDialog({ showSet, open, onClose }: FinishWorkDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { endSession } = useSessionStore();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentStage = getCurrentStage(showSet);
  const nextStage = getNextStage(currentStage);

  const updateStageMutation = useMutation({
    mutationFn: ({ stage, status }: { stage: StageName; status: string }) =>
      showSetsApi.updateStage(showSet.showSetId, stage, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['showsets'] });
    },
  });

  const handleFinish = async (markComplete: boolean) => {
    setIsSubmitting(true);
    try {
      if (markComplete) {
        // Mark current stage as complete
        await updateStageMutation.mutateAsync({
          stage: currentStage,
          status: 'complete',
        });
      }
      // End the session
      await endSession();
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onClose();
    } catch (error) {
      console.error('Failed to finish work:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentStageName = t(`stages.${currentStage}`);
  const nextStageName = nextStage ? t(`stages.${nextStage}`) : null;

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('sessions.finishWork')}</AlertDialogTitle>
          <AlertDialogDescription>
            {nextStageName ? (
              <>
                {t('sessions.stageCompleteQuestion', { stage: currentStageName })}
                <br />
                <span className="text-sm text-muted-foreground mt-1 block">
                  {t('sessions.nextStageReady', { stage: nextStageName })}
                </span>
              </>
            ) : (
              t('sessions.finalStageCompleteQuestion', { stage: currentStageName })
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting} onClick={() => handleFinish(false)}>
            {t('sessions.notYet')}
          </AlertDialogCancel>
          <AlertDialogAction disabled={isSubmitting} onClick={() => handleFinish(true)}>
            {t('sessions.yesComplete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
