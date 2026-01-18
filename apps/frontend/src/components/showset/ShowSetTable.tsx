import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Square, Play, MessageSquare, Pause, UserCheck, AlertTriangle } from 'lucide-react';
import type { ShowSet, StageName } from '@unisync/shared-types';
import { showSetsApi } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FinishWorkDialog } from './FinishWorkDialog';

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

// Get the current (first non-complete) stage
function getCurrentStage(showSet: ShowSet): StageName {
  for (const stage of STAGES) {
    if (showSet.stages[stage].status !== 'complete') {
      return stage;
    }
  }
  return 'drawing2d';
}

// Get the relevant version for a stage
function getVersionForStage(showSet: ShowSet, stage: StageName): number {
  switch (stage) {
    case 'screen':
      return showSet.screenVersion ?? 1;
    case 'structure':
    case 'integrated':
    case 'inBim360':
      return showSet.revitVersion ?? 1;
    case 'drawing2d':
      return showSet.drawingVersion ?? 1;
    default:
      return 1;
  }
}

export function ShowSetTable({ showSets, onSelect, onSelectNotes }: ShowSetTableProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { isWorking, currentShowSetId, startSession } = useSessionStore();
  const [finishDialogShowSet, setFinishDialogShowSet] = useState<ShowSet | null>(null);

  const updateStageMutation = useMutation({
    mutationFn: ({ showSetId, stage, status }: { showSetId: string; stage: StageName; status: string }) =>
      showSetsApi.updateStage(showSetId, stage, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['showsets'] });
    },
  });

  const getDescription = (showSet: ShowSet) => {
    const lang = i18n.language as 'en' | 'zh' | 'zh-TW';
    return showSet.description[lang] || showSet.description.en;
  };

  const handleStartWork = async (e: React.MouseEvent, showSet: ShowSet) => {
    e.stopPropagation();

    // Get current stage and transition to in_progress if not_started
    const currentStage = getCurrentStage(showSet);
    const currentStatus = showSet.stages[currentStage].status;

    if (currentStatus === 'not_started') {
      await updateStageMutation.mutateAsync({
        showSetId: showSet.showSetId,
        stage: currentStage,
        status: 'in_progress',
      });
    }

    await startSession(showSet.showSetId, `Working on ${showSet.showSetId}`);
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
  };

  const handleFinishWork = (e: React.MouseEvent, showSet: ShowSet) => {
    e.stopPropagation();
    setFinishDialogShowSet(showSet);
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
    </colgroup>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 rounded-lg border overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 bg-muted overflow-hidden" style={{ scrollbarGutter: 'stable' }}>
        <table className="w-full text-sm table-fixed">
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
            </tr>
          </thead>
        </table>
      </div>
      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin" style={{ scrollbarGutter: 'stable' }}>
        <table className="w-full text-sm table-fixed">
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
                  {isWorking && currentShowSetId === showSet.showSetId ? (
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
                      title="Start Working"
                      disabled={isWorking}
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </td>
              <td className="px-2 py-3 text-muted-foreground">{showSet.area}</td>
              <td className="px-2 py-3">{showSet.scene}</td>
              <td className="px-2 py-3 font-medium">{showSet.showSetId}</td>
              <td className="px-3 py-3 truncate">{getDescription(showSet)}</td>
              {STAGES.map((stage) => {
                const status = showSet.stages[stage].status;
                const version = getVersionForStage(showSet, stage);
                const showVersion = status !== 'not_started' && version > 1;
                return (
                  <td key={stage} className="px-2 py-3 text-center">
                    <Badge
                      variant={status as any}
                      className="text-xs w-full justify-center py-1.5"
                      title={`v${version}`}
                    >
                      {status === 'not_started' && '—'}
                      {status === 'in_progress' && (showVersion ? `WIP v${version}` : 'WIP')}
                      {status === 'complete' && (showVersion ? `✓ v${version}` : '✓')}
                      {status === 'on_hold' && <Pause className="h-4 w-4" />}
                      {status === 'client_review' && <UserCheck className="h-4 w-4" />}
                      {status === 'engineer_review' && <UserCheck className="h-4 w-4" />}
                      {status === 'revision_required' && <AlertTriangle className="h-4 w-4" />}
                    </Badge>
                  </td>
                );
              })}
            </tr>
          ))}
          </tbody>
        </table>
      </div>

      {/* Finish Work Dialog */}
      {finishDialogShowSet && (
        <FinishWorkDialog
          showSet={finishDialogShowSet}
          open={true}
          onClose={() => setFinishDialogShowSet(null)}
        />
      )}
    </div>
  );
}
