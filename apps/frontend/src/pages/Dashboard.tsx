import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Plus, LayoutGrid, Rows3, Search, X } from 'lucide-react';
import { showSetsApi } from '@/lib/api';
import { useUIStore } from '@/stores/ui-store';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ShowSetTable } from '@/components/showset/ShowSetTable';
import { KanbanBoard } from '@/components/showset/KanbanBoard';
import { ShowSetDetail } from '@/components/showset/ShowSetDetail';
import { CreateShowSetDialog } from '@/components/showset/CreateShowSetDialog';
import type { Area, StageStatus } from '@unisync/shared-types';

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { viewMode, setViewMode, filters, setFilter, resetFilters, selectedShowSetId, setSelectedShowSetId } =
    useUIStore();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [notesOnly, setNotesOnly] = useState(false);

  const handleSelectShowSet = (id: string) => {
    setSelectedShowSetId(id);
    setNotesOnly(false);
  };

  const handleSelectNotes = (id: string) => {
    setSelectedShowSetId(id);
    setNotesOnly(true);
  };

  const canCreate = user?.role === 'admin' || user?.role === 'bim_coordinator';

  const { data: showSets = [], isLoading } = useQuery({
    queryKey: ['showsets', filters.area !== 'all' ? filters.area : undefined],
    queryFn: () => showSetsApi.list(filters.area !== 'all' ? filters.area : undefined),
  });

  // Get unique scenes for filter dropdown
  const scenes = [...new Set(showSets.map((s) => s.scene))].sort();

  // Filter showSets based on search, scene, and status
  const filteredShowSets = showSets
    .filter((showSet) => {
      // Search filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const matchesId = showSet.showSetId.toLowerCase().includes(searchLower);
        const matchesScene = showSet.scene.toLowerCase().includes(searchLower);
        const matchesDescription =
          showSet.description.en.toLowerCase().includes(searchLower) ||
          showSet.description.zh.toLowerCase().includes(searchLower);
        if (!matchesId && !matchesScene && !matchesDescription) {
          return false;
        }
      }

      // Scene filter
      if (filters.scene && showSet.scene !== filters.scene) {
        return false;
      }

      // Status filter - check if any stage has the selected status
      if (filters.status !== 'all') {
        const stages = ['screen', 'structure', 'integrated', 'inBim360', 'drawing2d'] as const;
        const hasStatus = stages.some(
          (stage) => showSet.stages[stage]?.status === filters.status
        );
        if (!hasStatus) {
          return false;
        }
      }

      return true;
    })
    // Sort by project (area) then ShowSet ID
    .sort((a, b) => {
      const areaCompare = a.area.localeCompare(b.area);
      if (areaCompare !== 0) return areaCompare;
      return a.showSetId.localeCompare(b.showSetId);
    });

  const selectedShowSet = selectedShowSetId
    ? showSets.find((s) => s.showSetId === selectedShowSetId)
    : null;

  return (
    <div className="flex flex-col h-full space-y-4 overflow-hidden">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold md:text-2xl">{t('showset.title')}</h1>
        {canCreate && (
          <Button onClick={() => setCreateDialogOpen(true)} size="sm">
            <Plus className="h-4 w-4" />
            <span className="ml-2 hidden sm:inline">{t('showset.createNew')}</span>
          </Button>
        )}
      </div>

      {/* Toolbar */}
      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        {/* Search */}
        <div className="relative sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t('common.search')}
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-1 items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('showset.area')}:</span>
            <Select
              value={filters.area}
              onValueChange={(value) => setFilter('area', value as Area | 'all')}
            >
              <SelectTrigger className="w-40 sm:w-48">
                <SelectValue placeholder={t('showset.area')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="311">311 Attraction Tower</SelectItem>
                <SelectItem value="312">312 Marvel Plaza</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('showset.scene')}:</span>
            <Select
              value={filters.scene || 'all'}
              onValueChange={(value) => setFilter('scene', value === 'all' ? null : value)}
            >
              <SelectTrigger className="w-28 sm:w-32">
                <SelectValue placeholder={t('common.all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                {scenes.map((scene) => (
                  <SelectItem key={scene} value={scene}>
                    {scene}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('admin.status')}:</span>
            <Select
              value={filters.status}
              onValueChange={(value) => setFilter('status', value as StageStatus | 'all')}
            >
              <SelectTrigger className="w-28 sm:w-32">
                <SelectValue placeholder={t('status.not_started')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="not_started">{t('status.not_started')}</SelectItem>
                <SelectItem value="in_progress">{t('status.in_progress')}</SelectItem>
                <SelectItem value="engineer_review">{t('status.engineer_review')}</SelectItem>
                <SelectItem value="client_review">{t('status.client_review')}</SelectItem>
                <SelectItem value="complete">{t('status.complete')}</SelectItem>
                <SelectItem value="on_hold">{t('status.on_hold')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Clear Filters */}
          {(filters.area !== 'all' || filters.scene !== null || filters.status !== 'all' || filters.search !== '') && (
            <Button
              variant="ghost"
              size="icon"
              onClick={resetFilters}
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              title={t('common.clear')}
            >
              <X className="h-4 w-4" />
            </Button>
          )}

          <div className="flex-1" />

          {/* View Toggle */}
          <div className="flex rounded-md border">
            <Button
              variant={viewMode === 'table' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('table')}
              className="rounded-r-none"
            >
              <Rows3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('kanban')}
              className="rounded-l-none"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : filteredShowSets.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">
            {t('showset.noShowSets')}
          </p>
        ) : viewMode === 'table' ? (
          <ShowSetTable
            showSets={filteredShowSets}
            onSelect={handleSelectShowSet}
            onSelectNotes={handleSelectNotes}
          />
        ) : (
          <div className="overflow-auto flex-1 scrollbar-thin">
            <KanbanBoard
              showSets={filteredShowSets}
              onSelect={handleSelectShowSet}
            />
          </div>
        )}
      </div>

      {/* Detail Panel */}
      {selectedShowSet && (
        <ShowSetDetail
          showSet={selectedShowSet}
          open={!!selectedShowSetId}
          onClose={() => setSelectedShowSetId(null)}
          notesOnly={notesOnly}
        />
      )}

      {/* Create Dialog */}
      <CreateShowSetDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />
    </div>
  );
}
