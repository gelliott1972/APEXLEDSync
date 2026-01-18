import { useQuery as useTanstackQuery } from '@tanstack/react-query';
import { useQuery, useSubscription } from '@apollo/client';
import type { Session } from '@unisync/shared-types';
import { sessionsApi } from '../lib/api';
import { LIST_SESSIONS, ON_SESSION_CHANGED } from '../lib/graphql-operations';

// Return type for Sessions data hooks
interface SessionsDataResult {
  sessions: Session[];
  isLoading: boolean;
  error: string | undefined;
  refetch: () => void;
  isRealtime: boolean;
}

// GraphQL-based hook with subscriptions - only call when Apollo is available
export function useSessionsGraphQL(): SessionsDataResult {
  const { data, loading, error, refetch } = useQuery(LIST_SESSIONS, {
    fetchPolicy: 'cache-and-network',
  });

  // Subscribe to real-time session updates
  useSubscription(ON_SESSION_CHANGED, {
    onData: ({ data: subData }) => {
      if (subData?.data?.onSessionChanged) {
        // Refetch sessions when any session changes
        // Session updates are more complex (start/end), so full refetch is simpler
        refetch();
      }
    },
  });

  const sessions: Session[] = data?.listSessions ?? [];

  return {
    sessions,
    isLoading: loading,
    error: error?.message,
    refetch: () => refetch(),
    isRealtime: true,
  };
}

// REST API-based hook (uses polling for updates)
export function useSessionsREST(): SessionsDataResult {
  const { data, isLoading, error, refetch } = useTanstackQuery({
    queryKey: ['sessions'],
    queryFn: sessionsApi.list,
    refetchInterval: 30000, // Poll every 30 seconds
  });

  return {
    sessions: data ?? [],
    isLoading,
    error: error?.message,
    refetch,
    isRealtime: false,
  };
}

// Unified hook - uses REST by default
export function useSessionsData(): SessionsDataResult {
  return useSessionsREST();
}
