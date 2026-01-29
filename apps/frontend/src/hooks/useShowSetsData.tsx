import { useQuery as useTanstackQuery } from '@tanstack/react-query';
import { useApolloClient, useQuery, useSubscription } from '@apollo/client';
import { useContext, createContext, useMemo } from 'react';
import type { ShowSet } from '@unisync/shared-types';
import { showSetsApi } from '../lib/api';
import { LIST_SHOWSETS, ON_SHOWSET_UPDATED, SHOWSET_FRAGMENT } from '../lib/graphql-operations';

// Check at module level if GraphQL is configured
const GRAPHQL_URL = import.meta.env.VITE_GRAPHQL_URL ?? '';
const isGraphQLConfigured = !!GRAPHQL_URL;

// Context to track if we're inside an Apollo provider
const ApolloAvailableContext = createContext(false);

export const ApolloAvailableProvider = ({ children }: { children: React.ReactNode }) => {
  // Try to get Apollo client - if this throws, we're not in a provider
  let isAvailable = false;
  try {
    const client = useApolloClient();
    isAvailable = !!client;
  } catch {
    isAvailable = false;
  }

  return (
    <ApolloAvailableContext.Provider value={isAvailable}>
      {children}
    </ApolloAvailableContext.Provider>
  );
};

export const useIsGraphQLEnabled = () => useContext(ApolloAvailableContext);

// Transform GraphQL LocalizedString (zhTW) to our format ('zh-TW')
function transformLocalizedString(ls: { en: string; zh: string; zhTW?: string }) {
  return {
    en: ls.en,
    zh: ls.zh,
    'zh-TW': ls.zhTW ?? ls.zh,
  };
}

// Transform GraphQL ShowSet response to match our TypeScript types
function transformShowSet(data: Record<string, unknown>): ShowSet {
  const raw = data as {
    description: { en: string; zh: string; zhTW?: string };
    versionHistory: Array<{
      reason: { en: string; zh: string; zhTW?: string };
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };

  return {
    ...raw,
    description: transformLocalizedString(raw.description),
    versionHistory: (raw.versionHistory || []).map((entry) => ({
      ...entry,
      reason: transformLocalizedString(entry.reason),
    })),
  } as ShowSet;
}

// Parse ShowSet ID into components for smart sorting
// Format: SS-{scene}{shaft}-{screen}
// Example: SS-10BC-02 -> { scene: 10, shaft: 'BC', screen: 02 }
function parseShowSetId(showSetId: string): { scene: number; shaft: string; screen: number } {
  const match = showSetId.match(/^SS-(\d+)([A-Za-z]*)-(\d+)$/);
  if (!match) {
    // Fallback for invalid format
    return { scene: 0, shaft: '', screen: 0 };
  }
  return {
    scene: parseInt(match[1], 10),
    shaft: match[2] || '',
    screen: parseInt(match[3], 10),
  };
}

// Smart sort for ShowSets: Scene ASC, Screen ASC, Shaft ASC (alphabetically, case-insensitive)
function sortShowSets(showSets: ShowSet[]): ShowSet[] {
  return [...showSets].sort((a, b) => {
    const parsedA = parseShowSetId(a.showSetId);
    const parsedB = parseShowSetId(b.showSetId);

    // First, sort by scene
    if (parsedA.scene !== parsedB.scene) {
      return parsedA.scene - parsedB.scene;
    }

    // Then, sort by screen number
    if (parsedA.screen !== parsedB.screen) {
      return parsedA.screen - parsedB.screen;
    }

    // Finally, sort by shaft ID alphabetically (case-insensitive)
    return parsedA.shaft.toLowerCase().localeCompare(parsedB.shaft.toLowerCase());
  });
}

// Return type for ShowSets data hooks
interface ShowSetsDataResult {
  showSets: ShowSet[];
  isLoading: boolean;
  error: string | undefined;
  refetch: () => void;
  isRealtime: boolean;
}

// GraphQL-based hook with subscriptions - only call when Apollo is available
export function useShowSetsGraphQL(area?: string): ShowSetsDataResult {
  const { data, loading, error, refetch } = useQuery(LIST_SHOWSETS, {
    variables: { area },
    fetchPolicy: 'cache-and-network',
  });

  // Subscribe to real-time updates
  useSubscription(ON_SHOWSET_UPDATED, {
    variables: { area },
    onData: ({ client, data: subData }) => {
      if (subData?.data?.onShowSetUpdated) {
        const updatedShowSet = subData.data.onShowSetUpdated;

        // Update the cache directly for real-time updates
        client.cache.modify({
          fields: {
            listShowSets(existing = [], { readField }) {
              return existing.map((existingRef: { __ref: string }) => {
                if (readField('showSetId', existingRef) === updatedShowSet.showSetId) {
                  return client.cache.writeFragment({
                    data: updatedShowSet,
                    fragment: SHOWSET_FRAGMENT,
                    fragmentName: 'ShowSetFields',
                  });
                }
                return existingRef;
              });
            },
          },
        });
      }
    },
  });

  const showSets: ShowSet[] = useMemo(
    () => sortShowSets((data?.listShowSets || []).map(transformShowSet)),
    [data?.listShowSets]
  );

  return {
    showSets,
    isLoading: loading,
    error: error?.message,
    refetch: () => refetch(),
    isRealtime: true,
  };
}

// REST API-based hook (uses polling for updates)
export function useShowSetsREST(area?: string): ShowSetsDataResult {
  const { data, isLoading, error, refetch } = useTanstackQuery({
    queryKey: ['showsets', area],
    queryFn: () => showSetsApi.list(area),
    refetchInterval: 15000, // Poll every 15 seconds
  });

  const sortedShowSets = useMemo(() => sortShowSets(data ?? []), [data]);

  return {
    showSets: sortedShowSets,
    isLoading,
    error: error?.message,
    refetch,
    isRealtime: false,
  };
}

// Unified hook - uses REST by default, GraphQL when explicitly enabled
// For now, this always uses REST since Apollo hooks can't be conditionally called
// When GraphQL is deployed, components can use useShowSetsGraphQL directly
// when wrapped in ApolloProvider
export function useShowSetsData(area?: string): ShowSetsDataResult {
  // Always use REST for the unified hook - it's safe and always works
  // Components that want real-time can use useShowSetsGraphQL when inside ApolloProvider
  return useShowSetsREST(area);
}

// Export config check for components that need to conditionally render
export const isGraphQLAvailable = isGraphQLConfigured;
