import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Square, Play, MessageSquare, Lock, Minus, Loader2, Check, AlertTriangle, Clock, Pause } from 'lucide-react';
import type { ShowSet, StageName, StageStatus } from '@unisync/shared-types';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { Button } from '@/components/ui/button';
import { StartWorkDialog } from './StartWorkDialog';
import { FinishWorkDialog } from './FinishWorkDialog';
import { ApprovalDialog } from './ApprovalDialog';

interface ShowSetTableProps {
  showSets: ShowSet[];
  onSelect: (id: string) => void;
  onSelectNotes: (id: string) => void;
}

const STAGES: StageName[] = [
  'screen',
  'structure',
  'integrated',
  'inBim360',
  'drawing2d',
];

// Helper to check if ShowSet is locked (simple flag - admin controls)
function isShowSetLocked(showSet: ShowSet): boolean {
  return !!showSet.lockedAt;
}

// Get the relevant version for a stage - 3 deliverables (inBim360 has no version)
function getVersionForStage(showSet: ShowSet, stage: StageName): number | null {
  switch (stage) {
    case 'screen':
      return showSet.screenVersion ?? 1;
    case 'structure':
    case 'integrated':
      // Both share revitVersion with fallback for legacy data
      return showSet.revitVersion ?? Math.max(showSet.structureVersion ?? 1, showSet.integratedVersion ?? 1);
    case 'inBim360':
      return null; // No version - just uploads to BIM360 cloud
    case 'drawing2d':
      return showSet.drawingVersion ?? 1;
    default:
      return null;
  }
}

// Stage tile component with icon + version
function StageCell({ status, version, isBeingWorked }: {
  status: StageStatus;
  version: number | null;
  isBeingWorked: boolean;
}) {
  const getIcon = () => {
    switch (status) {
      case 'not_started':
        return <Minus className="h-4 w-4" />;
      case 'in_progress':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'complete':
        return <Check className="h-4 w-4" />;
      case 'revision_required':
        return <AlertTriangle className="h-4 w-4" />;
      case 'engineer_review':
      case 'client_review':
        return <Clock className="h-4 w-4" />;
      case 'on_hold':
        return <Pause className="h-4 w-4" />;
      default:
        return <Minus className="h-4 w-4" />;
    }
  };

  // Show version for stages that have versions (not inBim360) and not not_started
  const showVersion = version !== null && status !== 'not_started';

  // Get status-based class
  const statusClass = `stage-tile stage-tile--${status}`;
  const beingWorkedClass = isBeingWorked ? 'ring-2 ring-primary ring-offset-1' : '';

  return (
    <div className={`${statusClass} ${beingWorkedClass}`} title={showVersion ? `v${version}` : undefined}>
      {getIcon()}
      {showVersion && <span className="stage-version">v{version}</span>}
    </div>
  );
}

export function ShowSetTable({ showSets, onSelect, onSelectNotes }: ShowSetTableProps) {
  const { t, i18n } = useTranslation();
  const { effectiveRole } = useAuthStore();
  const { isWorking, currentShowSetId, workingStages } = useSessionStore();
  const [startDialogShowSet, setStartDialogShowSet] = useState<ShowSet | null>(null);
  const [finishDialogShowSet, setFinishDialogShowSet] = useState<ShowSet | null>(null);
  const [approvalDialogShowSet, setApprovalDialogShowSet] = useState<ShowSet | null>(null);

  const currentRole = effectiveRole();
  const isApprovalOnlyRole = currentRole === 'engineer' || currentRole === 'customer_reviewer';
  const isViewOnly = currentRole === 'view_only';

  const getDescription = (showSet: ShowSet) => {
    const lang = i18n.language as 'en' | 'zh' | 'zh-TW';
    return showSet.description[lang] || showSet.description.en;
  };

  const handleStartWork = (e: React.MouseEvent, showSet: ShowSet) => {
    e.stopPropagation();
    // Route to approval dialog for approval-only roles
    if (isApprovalOnlyRole) {
      setApprovalDialogShowSet(showSet);
    } else {
      setStartDialogShowSet(showSet);
    }
  };

  const handleFinishWork = (e: React.MouseEvent, showSet: ShowSet) => {
    e.stopPropagation();
    setFinishDialogShowSet(showSet);
  };

  // Check if a stage is currently being worked on
  const isStageBeingWorked = (showSetId: string, stage: StageName) => {
    return isWorking && currentShowSetId === showSetId && workingStages.includes(stage);
  };

  const colGroup = (
    <colgroup>
      <col style={{ width: '80px' }} />
      <col style={{ width: '64px' }} />
      <col style={{ width: '80px' }} />
      <col style={{ width: '112px' }} />
      <col />
      {STAGES.map((stage) => (
        <col key={stage} style={{ width: '72px' }} />
      ))}
      <col style={{ width: '72px' }} /> {/* Completed column */}
    </colgroup>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 rounded-lg border overflow-hidden table-scroll-container">
      {/* Header */}
      <div className="flex-shrink-0 bg-muted overflow-hidden" style={{ scrollbarGutter: 'stable' }}>
        <table className="w-full text-sm table-fixed min-w-[900px]">
          {colGroup}
          <thead className="text-xs uppercase">
            <tr>
              <th className="px-2 py-3"></th>
              <th className="px-2 py-3 text-left">{t('showset.area')}</th>
              <th className="px-2 py-3 text-left">{t('showset.scene')}</th>
              <th className="px-2 py-3 text-left">{t('showset.id')}</th>
              <th className="px-3 py-3 text-left">{t('showset.description')}</th>
              {STAGES.map((stage) => (
                <th key={stage} className="px-2 py-3 text-center">
                  {t(`stages.short.${stage}`)}
                </th>
              ))}
              <th className="px-2 py-3 text-center">
                {t('stages.short.completed')}
              </th>
            </tr>
          </thead>
        </table>
      </div>
      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin" style={{ scrollbarGutter: 'stable' }}>
        <table className="w-full text-sm table-fixed min-w-[900px]">
          {colGroup}
          <tbody className="divide-y">
            {showSets.map((showSet) => (
            <tr
              key={showSet.showSetId}
              className="hover:bg-muted/50 cursor-pointer"
              onClick={() => onSelect(showSet.showSetId)}
            >
              <td className="px-2 py-3">
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectNotes(showSet.showSetId);
                    }}
                    title="View Notes"
                  >
                    <MessageSquare className="h-3 w-3" />
                  </Button>
                  {!isViewOnly && (
                    isWorking && currentShowSetId === showSet.showSetId ? (
                      <Button
                        variant="destructive"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => handleFinishWork(e, showSet)}
                        title="Finish Working"
                      >
                        <Square className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-primary"
                        onClick={(e) => handleStartWork(e, showSet)}
                        title={isApprovalOnlyRole ? "Review" : "Start Working"}
                        disabled={isWorking}
                      >
                        <Play className="h-3 w-3" />
                      </Button>
                    )
                  )}
                </div>
              </td>
              <td className="px-2 py-3 text-muted-foreground">{showSet.area}</td>
              <td className="px-2 py-3">{showSet.scene}</td>
              <td className="px-2 py-3 font-medium">
                <div className="flex items-center gap-1">
                  {showSet.showSetId}
                  {isShowSetLocked(showSet) && (
                    <span title={t('showset.locked')}>
                      <Lock className="h-3 w-3 text-amber-600" />
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3 truncate">{getDescription(showSet)}</td>
              {STAGES.map((stage) => {
                const status = showSet.stages[stage].status;
                const version = getVersionForStage(showSet, stage);
                const beingWorked = isStageBeingWorked(showSet.showSetId, stage);

                return (
                  <td key={stage} className="px-2 py-3 text-center">
                    <StageCell
                      status={status}
                      version={version}
                      isBeingWorked={beingWorked}
                    />
                  </td>
                );
              })}
              {/* Completed column */}
              <td className="px-2 py-3 text-center">
                <StageCell
                  status={showSet.stages.drawing2d.status === 'complete' ? 'complete' : 'not_started'}
                  version={showSet.stages.drawing2d.status === 'complete' ? (showSet.drawingVersion ?? 1) : null}
                  isBeingWorked={false}
                />
              </td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>

      {/* Start Work Dialog */}
      {startDialogShowSet && (
        <StartWorkDialog
          showSet={startDialogShowSet}
          open={true}
          onClose={() => setStartDialogShowSet(null)}
        />
      )}

      {/* Finish Work Dialog */}
      {finishDialogShowSet && (
        <FinishWorkDialog
          showSet={finishDialogShowSet}
          open={true}
          onClose={() => setFinishDialogShowSet(null)}
        />
      )}

      {/* Approval Dialog (for engineer/customer_reviewer) */}
      {approvalDialogShowSet && (
        <ApprovalDialog
          showSet={approvalDialogShowSet}
          open={true}
          onClose={() => setApprovalDialogShowSet(null)}
        />
      )}
    </div>
  );
}
