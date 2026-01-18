import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Area, StageName, StageStatus } from '@unisync/shared-types';

type ViewMode = 'table' | 'kanban';
type Theme = 'light' | 'dark';

interface Filters {
  area: Area | 'all';
  scene: string | null;
  status: StageStatus | 'all';
  stage: StageName | 'all';
  search: string;
}

interface UIState {
  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  // View mode
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  // Version display toggle (icons vs version numbers)
  showVersionNumbers: boolean;
  setShowVersionNumbers: (show: boolean) => void;

  // Filters
  filters: Filters;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  resetFilters: () => void;

  // Selected ShowSet (for detail panel)
  selectedShowSetId: string | null;
  setSelectedShowSetId: (id: string | null) => void;

  // Sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const defaultFilters: Filters = {
  area: 'all',
  scene: null,
  status: 'all',
  stage: 'all',
  search: '',
};

// Apply theme to document
const applyTheme = (theme: Theme) => {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
};

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'light',
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggleTheme: () =>
        set((state) => {
          const newTheme = state.theme === 'light' ? 'dark' : 'light';
          applyTheme(newTheme);
          return { theme: newTheme };
        }),

      viewMode: 'table',
      setViewMode: (mode) => set({ viewMode: mode }),

      showVersionNumbers: false,
      setShowVersionNumbers: (show) => set({ showVersionNumbers: show }),

      filters: defaultFilters,
      setFilter: (key, value) =>
        set((state) => ({
          filters: { ...state.filters, [key]: value },
        })),
      resetFilters: () => set({ filters: defaultFilters }),

      selectedShowSetId: null,
      setSelectedShowSetId: (id) => set({ selectedShowSetId: id }),

      sidebarOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        theme: state.theme,
        viewMode: state.viewMode,
        showVersionNumbers: state.showVersionNumbers,
        sidebarOpen: state.sidebarOpen,
      }),
      onRehydrateStorage: () => (state) => {
        // Apply theme on page load
        if (state?.theme) {
          applyTheme(state.theme);
        }
      },
    }
  )
);
