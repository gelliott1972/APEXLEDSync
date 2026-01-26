import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ShowSet, StageName, StageStatus, UserRole } from '@unisync/shared-types';
import { STAGE_NAMES } from '@unisync/shared-types';
import { showSetsApi, notesApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
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

interface FinishWorkDialogProps {
  showSet: ShowSet;
  open: boolean;
  onClose: () => void;
}

type FinishOption = 'leave_in_progress' | 'mark_complete' | 'request_revision';

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

// Normalize language to our supported types
function normalizeLanguage(lang: string): 'en' | 'zh' | 'zh-TW' {
  if (lang === 'zh-TW') return 'zh-TW';
  if (lang.startsWith('zh')) return 'zh';
  return 'en';
}

export function FinishWorkDialog({ showSet, open, onClose }: FinishWorkDialogProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { effectiveRole } = useAuthStore();
  const { workingStages, endSession } = useSessionStore();
  const [finishOption, setFinishOption] = useState<FinishOption>('leave_in_progress');
  const [stagesToComplete, setStagesToComplete] = useState<StageName[]>([]);
  const [upstreamStagesToRevise, setUpstreamStagesToRevise] = useState<StageName[]>([]);
  const [revisionNote, setRevisionNote] = useState('');
  const [revisionAttachment, setRevisionAttachment] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentRole = effectiveRole();
  const currentLang = normalizeLanguage(i18n.language);

  // Get the earliest working stage (for determining upstream stages)
  const earliestWorkingStage = useMemo(() => {
    if (workingStages.length === 0) return null;
    const indices = workingStages.map(s => STAGE_NAMES.indexOf(s));
    const minIdx = Math.min(...indices);
    return STAGE_NAMES[minIdx];
  }, [workingStages]);

  // Get available upstream stages for revision requests
  const upstreamStages = useMemo(() => {
    if (!earliestWorkingStage) return [];
    const idx = STAGE_NAMES.indexOf(earliestWorkingStage);
    return STAGE_NAMES.slice(0, idx);
  }, [earliestWorkingStage]);

  const updateStageMutation = useMutation({
    mutationFn: ({ stage, status }: { stage: StageName; status: StageStatus }) =>
      showSetsApi.updateStage(showSet.showSetId, stage, { status }),
  });

  const requestRevisionMutation = useMutation({
    mutationFn: (input: { targetStages: StageName[]; currentStage: StageName; revisionNote: string; revisionNoteLang: 'en' | 'zh' | 'zh-TW' }) =>
      showSetsApi.requestUpstreamRevision(showSet.showSetId, input),
  });

  const toggleStageComplete = (stage: StageName) => {
    setStagesToComplete((prev) =>
      prev.includes(stage)
        ? prev.filter((s) => s !== stage)
        : [...prev, stage]
    );
  };

  const toggleUpstreamStage = (stage: StageName) => {
    setUpstreamStagesToRevise((prev) =>
      prev.includes(stage)
        ? prev.filter((s) => s !== stage)
        : [...prev, stage]
    );
  };

  const handleFinish = async () => {
    if (!currentRole || !earliestWorkingStage) return;

    setIsSubmitting(true);
    try {
      if (finishOption === 'request_revision') {
        // Request upstream revision
        if (upstreamStagesToRevise.length === 0) {
          alert(t('sessions.selectUpstreamStages'));
          setIsSubmitting(false);
          return;
        }
        if (!revisionNote.trim()) {
          alert(t('sessions.revisionNoteRequired'));
          setIsSubmitting(false);
          return;
        }

        // Build request with optional attachment metadata
        const revisionRequest: {
          targetStages: StageName[];
          currentStage: StageName;
          revisionNote: string;
          revisionNoteLang: 'en' | 'zh' | 'zh-TW';
          attachment?: { fileName: string; mimeType: string; fileSize: number };
        } = {
          targetStages: upstreamStagesToRevise,
          currentStage: earliestWorkingStage,
          revisionNote: revisionNote.trim(),
          revisionNoteLang: currentLang,
        };

        // Include attachment metadata if file selected
        if (revisionAttachment) {
          revisionRequest.attachment = {
            fileName: revisionAttachment.name,
            mimeType: revisionAttachment.type,
            fileSize: revisionAttachment.size,
          };
        }

        const result = await requestRevisionMutation.mutateAsync(revisionRequest);

        // If we got upload info back, upload the file to S3 and confirm
        if (revisionAttachment && result.uploadUrl && result.attachmentId && result.s3Key) {
          setUploadProgress(t('sessions.uploadingAttachment'));

          // Upload to S3
          const uploadResponse = await fetch(result.uploadUrl, {
            method: 'PUT',
            body: revisionAttachment,
            headers: {
              'Content-Type': revisionAttachment.type,
            },
          });

          if (!uploadResponse.ok) {
            console.error('Failed to upload attachment to S3');
            // Continue anyway - the revision was already created
          } else {
            // Confirm the upload
            await notesApi.confirmUpload(result.noteId, result.attachmentId, showSet.showSetId, {
              fileName: revisionAttachment.name,
              mimeType: revisionAttachment.type,
              fileSize: revisionAttachment.size,
              s3Key: result.s3Key,
            });
          }
        }
      } else {
        // Update stages based on what was selected
        for (const stage of workingStages) {
          const currentStatus = showSet.stages[stage].status;
          const markComplete = finishOption === 'mark_complete' && stagesToComplete.includes(stage);
          const newStatus = getFinishStatus(stage, currentStatus, currentRole, markComplete);

          // Only update if status is changing
          if (newStatus !== currentStatus) {
            await updateStageMutation.mutateAsync({
              stage,
              status: newStatus,
            });
          }
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
      setFinishOption('leave_in_progress');
      setStagesToComplete([]);
      setUpstreamStagesToRevise([]);
      setRevisionNote('');
      setRevisionAttachment(null);
      setUploadProgress('');
      onClose();
    }
  };

  const stageNames = workingStages.map((s) => t(`stages.${s}`)).join(', ');

  // Calculate what stages would be affected by upstream revision
  const affectedStagesForRevision = useMemo(() => {
    if (upstreamStagesToRevise.length === 0 || !earliestWorkingStage) return [];
    const indices = upstreamStagesToRevise.map(s => STAGE_NAMES.indexOf(s));
    const minIdx = Math.min(...indices);
    const currentIdx = STAGE_NAMES.indexOf(earliestWorkingStage);
    return STAGE_NAMES.slice(minIdx, currentIdx);
  }, [upstreamStagesToRevise, earliestWorkingStage]);

  // Check if view_only or reviewer - they shouldn't be able to request revisions
  const isViewOnly = currentRole === 'view_only' || currentRole === 'reviewer';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('sessions.finishWork')}</DialogTitle>
          <DialogDescription>
            {t('sessions.finishWorkDescription', { stages: stageNames })}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <RadioGroup
            value={finishOption}
            onValueChange={(value) => setFinishOption(value as FinishOption)}
            className="space-y-3"
          >
            {/* Option 1: Leave in progress */}
            <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
              <RadioGroupItem value="leave_in_progress" id="leave_in_progress" className="mt-0.5" />
              <Label htmlFor="leave_in_progress" className="flex-1 cursor-pointer">
                <div className="font-medium">{t('sessions.leaveInProgress')}</div>
                <div className="text-xs text-muted-foreground">{t('sessions.leaveInProgressDesc')}</div>
              </Label>
            </div>

            {/* Option 2: Mark as complete */}
            <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
              <RadioGroupItem value="mark_complete" id="mark_complete" className="mt-0.5" />
              <Label htmlFor="mark_complete" className="flex-1 cursor-pointer">
                <div className="font-medium">{t('sessions.markAsComplete')}</div>
                <div className="text-xs text-muted-foreground">{t('sessions.markAsCompleteDesc')}</div>
              </Label>
            </div>

            {/* Option 3: Request upstream revision (only if there are upstream stages and not view_only) */}
            {upstreamStages.length > 0 && !isViewOnly && (
              <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="request_revision" id="request_revision" className="mt-0.5" />
                <Label htmlFor="request_revision" className="flex-1 cursor-pointer">
                  <div className="font-medium">{t('sessions.requestUpstreamRevision')}</div>
                  <div className="text-xs text-muted-foreground">{t('sessions.requestUpstreamRevisionDesc')}</div>
                </Label>
              </div>
            )}
          </RadioGroup>

          {/* Show stage checkboxes for mark_complete option */}
          {finishOption === 'mark_complete' && (
            <div className="space-y-2 pl-2 border-l-2 border-primary/30 ml-4">
              <p className="text-sm font-medium text-muted-foreground">{t('sessions.markComplete')}</p>
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
                      onCheckedChange={() => toggleStageComplete(stage)}
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
          )}

          {/* Show upstream stage selection for request_revision option */}
          {finishOption === 'request_revision' && (
            <div className="space-y-3 pl-2 border-l-2 border-amber-500/50 ml-4">
              <p className="text-sm font-medium text-muted-foreground">{t('sessions.selectUpstreamStages')}</p>
              {upstreamStages.map((stage) => (
                <div key={stage} className="flex items-center space-x-3">
                  <Checkbox
                    id={`upstream-${stage}`}
                    checked={upstreamStagesToRevise.includes(stage)}
                    onCheckedChange={() => toggleUpstreamStage(stage)}
                  />
                  <Label htmlFor={`upstream-${stage}`} className="cursor-pointer">
                    {t(`stages.${stage}`)}
                  </Label>
                </div>
              ))}

              {upstreamStagesToRevise.length > 0 && affectedStagesForRevision.length > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t('sessions.upstreamRevisionWarning', {
                    stages: affectedStagesForRevision.map(s => t(`stages.${s}`)).join(', ')
                  })}
                </p>
              )}

              <div className="space-y-1">
                <Label htmlFor="revision-note" className="text-sm">
                  {t('sessions.revisionNoteRequired')} <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="revision-note"
                  value={revisionNote}
                  onChange={(e) => setRevisionNote(e.target.value)}
                  placeholder={t('sessions.revisionNotePlaceholder')}
                  rows={3}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="revision-attachment" className="text-sm">
                  {t('sessions.attachmentOptional')}
                </Label>
                <Input
                  id="revision-attachment"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
                  onChange={(e) => setRevisionAttachment(e.target.files?.[0] ?? null)}
                  className="cursor-pointer"
                />
                {revisionAttachment && (
                  <p className="text-xs text-muted-foreground">
                    {revisionAttachment.name} ({(revisionAttachment.size / 1024).toFixed(1)} KB)
                  </p>
                )}
                {uploadProgress && (
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    {uploadProgress}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleFinish}
            disabled={isSubmitting || (finishOption === 'request_revision' && (upstreamStagesToRevise.length === 0 || !revisionNote.trim()))}
          >
            {isSubmitting ? t('common.loading') : t('sessions.finishWork')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
