import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, Rows3, Search, X } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useShowSetsData } from '@/hooks/useShowSetsData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ShowSetTable } from '@/components/showset/ShowSetTable';
import { KanbanBoard } from '@/components/showset/KanbanBoard';
import { ShowSetDetail } from '@/components/showset/ShowSetDetail';
import type { Area } from '@unisync/shared-types';

export function DashboardPage() {
  const { t } = useTranslation();
  const { viewMode, setViewMode, showVersionNumbers, setShowVersionNumbers, filters, setFilter, resetFilters, selectedShowSetId, setSelectedShowSetId } =
    useUIStore();
  const [notesOnly, setNotesOnly] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  const handleSelectNotes = (id: string) => {
    setSelectedShowSetId(id);
    setNotesOnly(true);
  };

  const { showSets, isLoading } = useShowSetsData(
    filters.area !== 'all' ? filters.area : undefined
  );

  // Get unique scenes for filter dropdown
  const scenes = [...new Set(showSets.map((s) => s.scene))].sort();

  // Filter showSets based on search and scene
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

        {/* Version Toggle */}
        <div className="flex items-center gap-1.5">
          <Switch
            id="version-toggle"
            checked={showVersionNumbers}
            onCheckedChange={setShowVersionNumbers}
          />
          <Label htmlFor="version-toggle" className="text-sm cursor-pointer">
            {t('views.showVersions')}
          </Label>
        </div>

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
            onSelectNotes={handleSelectNotes}
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
    </div>
  );
}
