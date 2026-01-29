import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, AlertTriangle } from 'lucide-react';
import type { ShowSet, StageName, StageStatus, UserRole } from '@unisync/shared-types';
import { STAGE_PERMISSIONS } from '@unisync/shared-types';
import { showSetsApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
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

interface ApprovalDialogProps {
  showSet: ShowSet;
  open: boolean;
  onClose: () => void;
}

const STAGES_ORDER: StageName[] = [
  'screen',
  'structure',
  'inBim360',
  'drawing2d',
];

// Get the review status type this role can approve
function getReviewStatusForRole(role: UserRole): StageStatus | null {
  if (role === 'engineer') return 'engineer_review';
  if (role === 'customer_reviewer') return 'client_review';
  return null;
}

export function ApprovalDialog({ showSet, open, onClose }: ApprovalDialogProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { effectiveRole } = useAuthStore();
  const [selectedStages, setSelectedStages] = useState<StageName[]>([]);
  const [decision, setDecision] = useState<'complete' | 'revision_required'>('complete');
  const [revisionNote, setRevisionNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentRole = effectiveRole();
  const reviewStatus = currentRole ? getReviewStatusForRole(currentRole) : null;

  // Get stages the user can approve (has permission and is in the correct review status)
  const availableStages = useMemo(() => {
    if (!currentRole || !reviewStatus) return [];
    const userStages = STAGE_PERMISSIONS[currentRole] || [];
    return STAGES_ORDER.filter((stage) => {
      const stageInfo = showSet.stages[stage];
      // Must have permission for this stage
      if (!userStages.includes(stage)) return false;
      // Stage must be in the review status this role can approve
      return stageInfo.status === reviewStatus;
    });
  }, [currentRole, reviewStatus, showSet]);

  // Pre-select all available stages by default
  useState(() => {
    if (availableStages.length > 0 && selectedStages.length === 0) {
      setSelectedStages([...availableStages]);
    }
  });

  const updateStageMutation = useMutation({
    mutationFn: ({ stage, status, revisionNote: note, revisionNoteLang }: {
      stage: StageName;
      status: StageStatus;
      revisionNote?: string;
      revisionNoteLang?: 'en' | 'zh' | 'zh-TW';
    }) =>
      showSetsApi.updateStage(showSet.showSetId, stage, {
        status,
        revisionNote: note,
        revisionNoteLang,
      }),
  });

  const toggleStage = (stage: StageName) => {
    setSelectedStages((prev) =>
      prev.includes(stage)
        ? prev.filter((s) => s !== stage)
        : [...prev, stage]
    );
  };

  const handleSubmit = async () => {
    if (selectedStages.length === 0) return;

    // Require note for revision_required
    if (decision === 'revision_required' && !revisionNote.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const currentLang = i18n.language as 'en' | 'zh' | 'zh-TW';

      // Update all selected stages
      for (const stage of selectedStages) {
        await updateStageMutation.mutateAsync({
          stage,
          status: decision,
          revisionNote: decision === 'revision_required' ? revisionNote.trim() : undefined,
          revisionNoteLang: decision === 'revision_required' ? currentLang : undefined,
        });
      }

      queryClient.invalidateQueries({ queryKey: ['showsets'] });
      queryClient.invalidateQueries({ queryKey: ['notes', showSet.showSetId] });
      onClose();
    } catch (error) {
      console.error('Failed to submit approval:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedStages([]);
      setDecision('complete');
      setRevisionNote('');
      onClose();
    }
  };

  // Validation - note required for revision_required
  const isValid = selectedStages.length > 0 &&
    (decision === 'complete' || revisionNote.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('approval.title', 'Review Stages')}</DialogTitle>
          <DialogDescription>
            {t('approval.description', 'Review and approve or request revision for stages on {{id}}.', { id: showSet.showSetId })}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {availableStages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('approval.noStages', 'No stages available for review.')}
            </p>
          ) : (
            <>
              {/* Stage selection */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">{t('approval.selectStages', 'Select stages to review')}</Label>
                {availableStages.map((stage) => (
                  <div key={stage} className="flex items-center space-x-3">
                    <Checkbox
                      id={`approval-${stage}`}
                      checked={selectedStages.includes(stage)}
                      onCheckedChange={() => toggleStage(stage)}
                    />
                    <Label
                      htmlFor={`approval-${stage}`}
                      className="flex-1 flex items-center justify-between cursor-pointer"
                    >
                      <span className="font-medium">{t(`stages.${stage}`)}</span>
                      <span className="text-xs text-muted-foreground">
                        {t(`status.${reviewStatus}`)}
                      </span>
                    </Label>
                  </div>
                ))}
              </div>

              {/* Decision radio */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">{t('approval.decision', 'Decision')}</Label>
                <RadioGroup
                  value={decision}
                  onValueChange={(value) => setDecision(value as 'complete' | 'revision_required')}
                  className="space-y-2"
                >
                  <div className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted/50">
                    <RadioGroupItem value="complete" id="decision-complete" />
                    <Label htmlFor="decision-complete" className="flex items-center gap-2 cursor-pointer flex-1">
                      <Check className="h-4 w-4 text-emerald-500" />
                      <span>{t('status.complete')}</span>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted/50">
                    <RadioGroupItem value="revision_required" id="decision-revision" />
                    <Label htmlFor="decision-revision" className="flex items-center gap-2 cursor-pointer flex-1">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span>{t('status.revision_required')}</span>
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Revision note - only shown when revision_required is selected */}
              {decision === 'revision_required' && (
                <div className="space-y-2">
                  <Label htmlFor="revision-note" className="text-sm font-medium">
                    {t('revision.description', 'Please describe what changes are required.')} *
                  </Label>
                  <Textarea
                    id="revision-note"
                    placeholder={t('revision.placeholder')}
                    value={revisionNote}
                    onChange={(e) => setRevisionNote(e.target.value)}
                    rows={4}
                    className="resize-none"
                  />
                  {revisionNote.trim().length === 0 && (
                    <p className="text-xs text-destructive">
                      {t('approval.noteRequired', 'A note is required when requesting revision.')}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting || availableStages.length === 0}
          >
            {isSubmitting ? t('common.loading') : t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
