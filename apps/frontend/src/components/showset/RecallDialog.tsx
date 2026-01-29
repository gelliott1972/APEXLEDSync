import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import type { ShowSet, StageName } from '@unisync/shared-types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// Stage order for determining upstream/downstream
const STAGE_ORDER: StageName[] = ['screen', 'structure', 'inBim360', 'drawing2d'];

// Valid recall targets by review stage
function getValidRecallTargets(reviewStage: StageName): StageName[] {
  switch (reviewStage) {
    case 'structure':
      // structure in engineer_review can recall to screen or structure
      return ['screen', 'structure'];
    case 'inBim360':
      // inBim360 in client_review can recall to screen, structure, or inBim360
      return ['screen', 'structure', 'inBim360'];
    case 'drawing2d':
      // drawing2d can only recall to itself
      return ['drawing2d'];
    default:
      return [];
  }
}

// Get stages that will be affected (set to revision_required)
function getAffectedStages(targetStage: StageName, reviewStage: StageName, showSet: ShowSet): StageName[] {
  const targetIdx = STAGE_ORDER.indexOf(targetStage);
  const reviewIdx = STAGE_ORDER.indexOf(reviewStage);

  // All stages from target+1 to review (inclusive) will be affected
  const affected: StageName[] = [];
  for (let i = targetIdx + 1; i <= reviewIdx; i++) {
    const stage = STAGE_ORDER[i];
    affected.push(stage);
  }

  // Also check if downstream stages are complete (they'll be reset too)
  const downstreamStages = STAGE_ORDER.slice(reviewIdx + 1);
  for (const ds of downstreamStages) {
    const status = showSet.stages[ds].status;
    if (status === 'complete') {
      affected.push(ds);
    }
  }

  return affected;
}

export interface RecallDialogProps {
  showSet: ShowSet;
  reviewStage: StageName;  // The stage currently in review
  open: boolean;
  onClose: () => void;
  onConfirm: (targetStage: StageName, startWork: boolean, note?: string) => void;
}

export function RecallDialog({ showSet, reviewStage, open, onClose, onConfirm }: RecallDialogProps) {
  const { t } = useTranslation();
  const [selectedTarget, setSelectedTarget] = useState<StageName | null>(null);
  const [startWork, setStartWork] = useState(true);
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validTargets = useMemo(() => getValidRecallTargets(reviewStage), [reviewStage]);

  const affectedStages = useMemo(() => {
    if (!selectedTarget) return [];
    return getAffectedStages(selectedTarget, reviewStage, showSet);
  }, [selectedTarget, reviewStage, showSet]);

  const handleConfirm = async () => {
    if (!selectedTarget) return;

    setIsSubmitting(true);
    try {
      await onConfirm(selectedTarget, startWork, note || undefined);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedTarget(null);
      setStartWork(true);
      setNote('');
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('sessions.recallFromReview')}</DialogTitle>
          <DialogDescription>
            {t('sessions.selectRecallTarget')}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Current stage in review info */}
          <div className="text-sm text-muted-foreground">
            {t('stages.' + reviewStage)} - {t('status.' + showSet.stages[reviewStage].status)}
          </div>

          {/* Target stage selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">
              {t('sessions.selectRecallTarget')}
            </Label>
            <RadioGroup
              value={selectedTarget ?? ''}
              onValueChange={(value: string) => setSelectedTarget(value as StageName)}
            >
              {validTargets.map((stage) => (
                <div key={stage} className="flex items-center space-x-3">
                  <RadioGroupItem value={stage} id={`recall-${stage}`} />
                  <Label
                    htmlFor={`recall-${stage}`}
                    className="flex-1 cursor-pointer"
                  >
                    {t(`stages.${stage}`)}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Warning about affected stages */}
          {selectedTarget && affectedStages.length > 0 && (
            <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p>
                  {t('sessions.recallWarning', {
                    stages: affectedStages.map((s) => t(`stages.${s}`)).join(', '),
                  })}
                </p>
              </div>
            </div>
          )}

          {/* Start working checkbox */}
          <div className="flex items-center space-x-3">
            <Checkbox
              id="start-work"
              checked={startWork}
              onCheckedChange={(checked) => setStartWork(checked === true)}
            />
            <Label htmlFor="start-work" className="cursor-pointer">
              {t('sessions.startWorkingOnStage')}
            </Label>
          </div>

          {/* Optional note */}
          <div className="space-y-2">
            <Label htmlFor="recall-note" className="text-sm">
              {t('sessions.recallNote')}
            </Label>
            <Textarea
              id="recall-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('sessions.recallNotePlaceholder')}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedTarget || isSubmitting}
          >
            {isSubmitting ? t('common.loading') : t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
