import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Square, Play, MessageSquare, Pause, UserCheck, AlertTriangle } from 'lucide-react';
import type { ShowSet, StageName } from '@unisync/shared-types';
import { useSessionStore } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StartWorkDialog } from './StartWorkDialog';
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
  const { isWorking, currentShowSetId, workingStages } = useSessionStore();
  const { showVersionNumbers } = useUIStore();
  const [startDialogShowSet, setStartDialogShowSet] = useState<ShowSet | null>(null);
  const [finishDialogShowSet, setFinishDialogShowSet] = useState<ShowSet | null>(null);

  const getDescription = (showSet: ShowSet) => {
    const lang = i18n.language as 'en' | 'zh' | 'zh-TW';
    return showSet.description[lang] || showSet.description.en;
  };

  const handleStartWork = (e: React.MouseEvent, showSet: ShowSet) => {
    e.stopPropagation();
    setStartDialogShowSet(showSet);
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
                const beingWorked = isStageBeingWorked(showSet.showSetId, stage);

                // Determine badge content based on showVersionNumbers toggle
                const getBadgeContent = () => {
                  if (status === 'not_started') return '—';

                  if (showVersionNumbers) {
                    // Show version numbers
                    return `v${version}`;
                  } else {
                    // Show status icons
                    switch (status) {
                      case 'in_progress': return 'WIP';
                      case 'complete': return '✓';
                      case 'on_hold': return <Pause className="h-4 w-4" />;
                      case 'client_review': return <UserCheck className="h-4 w-4" />;
                      case 'engineer_review': return <UserCheck className="h-4 w-4" />;
                      case 'revision_required': return <AlertTriangle className="h-4 w-4" />;
                      default: return '—';
                    }
                  }
                };

                return (
                  <td key={stage} className="px-2 py-3 text-center">
                    <Badge
                      variant={status as any}
                      className={`text-xs w-full justify-center py-1.5 ${beingWorked ? 'ring-2 ring-primary ring-offset-1 animate-pulse' : ''}`}
                      title={`v${version}`}
                    >
                      {getBadgeContent()}
                    </Badge>
                  </td>
                );
              })}
              {/* Completed column */}
              <td className="px-2 py-3 text-center">
                {showSet.stages.drawing2d.status === 'complete' ? (
                  <Badge
                    variant="complete"
                    className="text-xs w-full justify-center py-1.5"
                    title={`v${showSet.drawingVersion ?? 1}`}
                  >
                    {showVersionNumbers ? `v${showSet.drawingVersion ?? 1}` : '✓'}
                  </Badge>
                ) : (
                  <Badge
                    variant="not_started"
                    className="text-xs w-full justify-center py-1.5"
                  >
                    —
                  </Badge>
                )}
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
    </div>
  );
}
