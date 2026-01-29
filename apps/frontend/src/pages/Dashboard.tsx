import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueries } from '@tanstack/react-query';
import { LayoutGrid, Rows3, Search, X } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useShowSetsData } from '@/hooks/useShowSetsData';
import { issuesApi } from '@/lib/api';
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
import { IssuesModal } from '@/components/issues/IssuesModal';
import type { Area, Issue } from '@unisync/shared-types';

export function DashboardPage() {
  const { t } = useTranslation();
  const { viewMode, setViewMode, filters, setFilter, resetFilters, selectedShowSetId, setSelectedShowSetId } =
    useUIStore();
  const [notesOnly, setNotesOnly] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Issues modal state
  const [issuesModalOpen, setIssuesModalOpen] = useState(false);
  const [issuesModalShowSetId, setIssuesModalShowSetId] = useState<string | undefined>();
  const [issuesModalShowSetName, setIssuesModalShowSetName] = useState<string | undefined>();

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  const handleSelectShowSet = (id: string) => {
    setSelectedShowSetId(id);
    setNotesOnly(false);
  };

  const handleOpenIssuesModal = (showSetId: string, showSetName: string) => {
    setIssuesModalShowSetId(showSetId);
    setIssuesModalShowSetName(showSetName);
    setIssuesModalOpen(true);
  };

  const handleCloseIssuesModal = () => {
    setIssuesModalOpen(false);
    setIssuesModalShowSetId(undefined);
    setIssuesModalShowSetName(undefined);
  };

  const { showSets, isLoading } = useShowSetsData(
    filters.area !== 'all' ? filters.area : undefined
  );

  // Get unique scenes for filter dropdown
  const scenes = [...new Set(showSets.map((s) => s.scene))].sort();

  // Filter showSets based on search and scene
  // Helper to parse ShowSet ID for smart sorting
  const parseShowSetId = (showSetId: string): { scene: number; shaft: string; screen: number } => {
    const match = showSetId.match(/^SS-(\d+)([A-Za-z]*)-(\d+)$/);
    if (!match) {
      return { scene: 0, shaft: '', screen: 0 };
    }
    return {
      scene: parseInt(match[1], 10),
      shaft: match[2] || '',
      screen: parseInt(match[3], 10),
    };
  };

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

      return true;
    })
    // Sort by project (area) then ShowSet ID (smart sort: scene, screen, shaft)
    .sort((a, b) => {
      const areaCompare = a.area.localeCompare(b.area);
      if (areaCompare !== 0) return areaCompare;

      // Smart sort by scene, screen, then shaft
      const parsedA = parseShowSetId(a.showSetId);
      const parsedB = parseShowSetId(b.showSetId);

      if (parsedA.scene !== parsedB.scene) {
        return parsedA.scene - parsedB.scene;
      }

      if (parsedA.screen !== parsedB.screen) {
        return parsedA.screen - parsedB.screen;
      }

      return parsedA.shaft.toLowerCase().localeCompare(parsedB.shaft.toLowerCase());
    });

  const selectedShowSet = selectedShowSetId
    ? showSets.find((s) => s.showSetId === selectedShowSetId)
    : null;

  // Query issues for all visible showSets to get open issue counts
  const showSetIds = useMemo(() => filteredShowSets.map(s => s.showSetId), [filteredShowSets]);
  const issuesQueries = useQueries({
    queries: showSetIds.map(showSetId => ({
      queryKey: ['issues', showSetId],
      queryFn: () => issuesApi.list(showSetId),
      staleTime: 60000,
      refetchInterval: 60000,
    })),
  });

  // Compute open issue counts per showSet
  const issueCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    issuesQueries.forEach((query, index) => {
      const showSetId = showSetIds[index];
      if (query.data) {
        // Count open issues (excluding replies)
        counts[showSetId] = (query.data as Issue[]).filter(
          issue => issue.status === 'open' && !issue.parentIssueId
        ).length;
      }
    });
    return counts;
  }, [issuesQueries, showSetIds]);

  return (
    <div className="flex flex-col h-full space-y-2 overflow-hidden">
      {/* Toolbar - single line */}
      <div className="flex items-center gap-2">
        {/* Area Filter */}
        <Select
          value={filters.area}
          onValueChange={(value) => setFilter('area', value as Area | 'all')}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder={t('showset.area')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.all')}</SelectItem>
            <SelectItem value="311">311 Attraction</SelectItem>
            <SelectItem value="312">312 Marvel</SelectItem>
          </SelectContent>
        </Select>

        {/* Scene Filter */}
        <Select
          value={filters.scene || 'all'}
          onValueChange={(value) => setFilter('scene', value === 'all' ? null : value)}
        >
          <SelectTrigger className="w-24">
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

        {/* Clear Filters */}
        {(filters.area !== 'all' || filters.scene !== null || filters.search !== '') && (
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

        {/* Search Toggle */}
        <Button
          variant={searchOpen ? 'secondary' : 'ghost'}
          size="icon"
          onClick={() => setSearchOpen(!searchOpen)}
          className="h-8 w-8"
          title={t('common.search')}
        >
          <Search className="h-4 w-4" />
        </Button>

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

      {/* Collapsible Search Bar */}
      {searchOpen && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            ref={searchInputRef}
            placeholder={t('common.search')}
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            className="pl-9"
          />
        </div>
      )}

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
            onOpenIssuesModal={handleOpenIssuesModal}
            issueCounts={issueCounts}
          />
        ) : (
          <KanbanBoard
            showSets={filteredShowSets}
            onSelect={handleSelectShowSet}
          />
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

      {/* Issues Modal */}
      <IssuesModal
        open={issuesModalOpen}
        onClose={handleCloseIssuesModal}
        showSetId={issuesModalShowSetId}
        showSetName={issuesModalShowSetName}
      />
    </div>
  );
}
