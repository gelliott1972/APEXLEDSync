import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ShowSet, StageName, StageStatus, UserRole } from '@unisync/shared-types';
import { STAGE_PERMISSIONS } from '@unisync/shared-types';
import { showSetsApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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

type VersionType = 'screenVersion' | 'structureVersion' | 'integratedVersion' | 'bim360Version' | 'drawingVersion';

// Get the version type for a stage - each stage has its own version
function getVersionTypeForStage(stage: StageName): VersionType {
  switch (stage) {
    case 'screen':
      return 'screenVersion';
    case 'structure':
      return 'structureVersion';
    case 'integrated':
      return 'integratedVersion';
    case 'inBim360':
      return 'bim360Version';
    case 'drawing2d':
      return 'drawingVersion';
    default:
      return 'structureVersion';
  }
}

// Get display label for a version type
function getVersionLabel(vt: VersionType): string {
  switch (vt) {
    case 'screenVersion': return 'Screen';
    case 'structureVersion': return 'Structure';
    case 'integratedVersion': return 'Integrated';
    case 'bim360Version': return 'BIM360';
    case 'drawingVersion': return '2D';
    default: return '';
  }
}

// Get the current version for a stage with fallback for legacy data
function getCurrentVersion(showSet: ShowSet, vt: VersionType): number {
  switch (vt) {
    case 'screenVersion':
      return showSet.screenVersion ?? 1;
    case 'structureVersion':
      return showSet.structureVersion ?? showSet.revitVersion ?? 1;
    case 'integratedVersion':
      return showSet.integratedVersion ?? showSet.revitVersion ?? 1;
    case 'bim360Version':
      return showSet.bim360Version ?? showSet.revitVersion ?? 1;
    case 'drawingVersion':
      return showSet.drawingVersion ?? 1;
    default:
      return 1;
  }
}

// Check if a stage needs revision work (either has revision_required status or is complete with downstream rejection)
function stageNeedsRevision(showSet: ShowSet, stage: StageName): boolean {
  const status = showSet.stages[stage].status;
  return status === 'revision_required' || (status === 'complete' && downstreamNeedsRevision(showSet, stage));
}

export function StartWorkDialog({ showSet, open, onClose }: StartWorkDialogProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { effectiveRole } = useAuthStore();
  const { startSession } = useSessionStore();
  const [selectedStages, setSelectedStages] = useState<StageName[]>([]);
  const [incrementVersion, setIncrementVersion] = useState(false);
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

  // Check if any selected stage needs revision work
  const hasRevisionStages = useMemo(() => {
    return selectedStages.some(stage => stageNeedsRevision(showSet, stage));
  }, [selectedStages, showSet]);

  // Get version types that will be incremented and build the label
  const versionLabel = useMemo(() => {
    if (!hasRevisionStages) return '';
    const versionTypes = [...new Set(
      selectedStages
        .filter(stage => stageNeedsRevision(showSet, stage))
        .map(getVersionTypeForStage)
    )];
    return versionTypes.map(vt => {
      const current = getCurrentVersion(showSet, vt);
      return `${getVersionLabel(vt)}: v${current} → v${current + 1}`;
    }).join(', ');
  }, [hasRevisionStages, selectedStages, showSet]);

  const updateStageMutation = useMutation({
    mutationFn: ({ stage, status, skipVersionIncrement }: { stage: StageName; status: StageStatus; skipVersionIncrement?: boolean }) =>
      showSetsApi.updateStage(showSet.showSetId, stage, {
        status,
        ...(skipVersionIncrement !== undefined && { skipVersionIncrement }),
      }),
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
      // Set all selected stages to in_progress if they need to be started/reworked
      // Backend auto-increments version when going revision_required -> in_progress
      // For "complete" stages with downstream rejection, we need to explicitly increment
      for (const stage of selectedStages) {
        const status = showSet.stages[stage].status;
        const isDownstreamRejection = status === 'complete' && downstreamNeedsRevision(showSet, stage);

        // Start work if: not_started, revision_required, or complete (for rework due to downstream rejection)
        if (status === 'not_started' || status === 'revision_required' || isDownstreamRejection) {
          // For downstream rejection case, explicitly increment version if user wants it
          // (backend only auto-increments for revision_required -> in_progress)
          if (isDownstreamRejection && incrementVersion) {
            const versionType = getVersionTypeForStage(stage);
            const currentVersion = getCurrentVersion(showSet, versionType);
            const normalizedLang = i18n.language === 'zh-TW' ? 'zh-TW'
              : i18n.language.startsWith('zh') ? 'zh'
              : 'en';
            await showSetsApi.updateVersion(showSet.showSetId, {
              versionType,
              targetVersion: currentVersion + 1,
              language: normalizedLang,
            });
          }

          // Only pass skipVersionIncrement for stages that would trigger backend auto-increment
          const wouldAutoIncrement = status === 'revision_required';
          await updateStageMutation.mutateAsync({
            stage,
            status: 'in_progress',
            // Skip auto-increment if user has toggle OFF and this stage would auto-increment
            ...(wouldAutoIncrement && !incrementVersion ? { skipVersionIncrement: true } : {}),
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
      setIncrementVersion(false);
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
          <div className="space-y-3">
            {availableStages.length === 0 ? (
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

          {/* Version increment toggle - only shown when starting revision work */}
          {hasRevisionStages && (
            <div className="pt-3 border-t">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{t('sessions.incrementVersion')}</p>
                  <p className="text-xs text-muted-foreground">{versionLabel}</p>
                </div>
                <Switch
                  checked={incrementVersion}
                  onCheckedChange={setIncrementVersion}
                />
              </div>
            </div>
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
