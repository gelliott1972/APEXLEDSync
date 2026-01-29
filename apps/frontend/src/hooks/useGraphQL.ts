import { useQuery, useMutation, useSubscription } from '@apollo/client';
import type { ShowSet, Session, StageName, StageStatus } from '@unisync/shared-types';
import {
  LIST_SHOWSETS,
  GET_SHOWSET,
  LIST_SESSIONS,
  UPDATE_STAGE,
  UPDATE_LINKS,
  UPDATE_VERSION,
  START_SESSION,
  END_SESSION,
  HEARTBEAT,
  ON_SHOWSET_UPDATED,
  ON_SESSION_CHANGED,
} from '../lib/graphql-operations';

// Raw GraphQL response types (uses zhTW instead of zh-TW)
interface RawLocalizedString {
  en: string;
  zh: string;
  zhTW?: string;
}

interface RawVersionHistoryEntry {
  id: string;
  versionType: string;
  version: number;
  reason: RawLocalizedString;
  createdAt: string;
  createdBy: string;
}

interface RawShowSet extends Omit<ShowSet, 'description' | 'versionHistory'> {
  description: RawLocalizedString;
  versionHistory: RawVersionHistoryEntry[];
}

// Transform GraphQL response to match existing types
// GraphQL uses zhTW but our types use 'zh-TW'
function transformShowSet(data: Record<string, unknown>): ShowSet {
  const showSet = data as unknown as RawShowSet;

  return {
    ...showSet,
    description: {
      en: showSet.description.en,
      zh: showSet.description.zh,
      'zh-TW': showSet.description.zhTW ?? showSet.description.zh,
    },
    versionHistory: (showSet.versionHistory || []).map((entry) => ({
      ...entry,
      reason: {
        en: entry.reason.en,
        zh: entry.reason.zh,
        'zh-TW': entry.reason.zhTW ?? entry.reason.zh,
      },
    })),
  } as ShowSet;
}

// Hook for listing ShowSets with real-time updates
export function useShowSets(area?: string) {
  const { data, loading, error, refetch } = useQuery(LIST_SHOWSETS, {
    variables: { area },
    pollInterval: 0, // No polling needed with subscriptions
  });

  // Subscribe to real-time updates
  useSubscription(ON_SHOWSET_UPDATED, {
    variables: { area },
    onData: ({ client, data: subData }) => {
      if (subData?.data?.onShowSetUpdated) {
        const updatedShowSet = subData.data.onShowSetUpdated;

        // Update the cache
        client.cache.modify({
          fields: {
            listShowSets(existing = [], { readField }) {
              const existingIndex = existing.findIndex(
                (ref: { __ref: string }) => readField('showSetId', ref) === updatedShowSet.showSetId
              );

              if (existingIndex >= 0) {
                // Update existing item
                const newList = [...existing];
                newList[existingIndex] = client.cache.writeFragment({
                  data: updatedShowSet,
                  fragment: LIST_SHOWSETS,
                });
                return newList;
              }
              return existing;
            },
          },
        });
      }
    },
  });

  const showSets: ShowSet[] = data?.listShowSets?.map(transformShowSet) ?? [];

  return {
    showSets,
    loading,
    error,
    refetch,
  };
}

// Hook for getting a single ShowSet
export function useShowSet(showSetId: string) {
  const { data, loading, error, refetch } = useQuery(GET_SHOWSET, {
    variables: { showSetId },
    skip: !showSetId,
  });

  const showSet: ShowSet | null = data?.getShowSet
    ? transformShowSet(data.getShowSet)
    : null;

  return {
    showSet,
    loading,
    error,
    refetch,
  };
}

// Hook for listing Sessions with real-time updates
export function useSessions() {
  const { data, loading, error, refetch } = useQuery(LIST_SESSIONS, {
    pollInterval: 0, // No polling needed with subscriptions
  });

  // Subscribe to real-time session changes
  useSubscription(ON_SESSION_CHANGED, {
    onData: () => {
      // Refetch sessions when any session changes
      // This is simpler than complex cache updates for session data
      refetch();
    },
  });

  const sessions: Session[] = data?.listSessions ?? [];

  return {
    sessions,
    loading,
    error,
    refetch,
  };
}

// Hook for updating a stage
export function useUpdateStage() {
  const [mutate, { loading, error }] = useMutation(UPDATE_STAGE);

  const updateStage = async (
    showSetId: string,
    stage: StageName,
    input: {
      status: StageStatus;
      assignedTo?: string | null;
      version?: string;
      revisionNote?: string;
      revisionNoteLang?: string;
      skipVersionIncrement?: boolean;
    }
  ) => {
    const result = await mutate({
      variables: { showSetId, stage, input },
    });
    return result.data?.updateStage ? transformShowSet(result.data.updateStage) : null;
  };

  return {
    updateStage,
    loading,
    error,
  };
}

// Hook for updating links
export function useUpdateLinks() {
  const [mutate, { loading, error }] = useMutation(UPDATE_LINKS);

  const updateLinks = async (
    showSetId: string,
    input: { modelUrl?: string | null; drawingsUrl?: string | null }
  ) => {
    const result = await mutate({
      variables: { showSetId, input },
    });
    return result.data?.updateLinks ? transformShowSet(result.data.updateLinks) : null;
  };

  return {
    updateLinks,
    loading,
    error,
  };
}

// Hook for updating version
export function useUpdateVersion() {
  const [mutate, { loading, error }] = useMutation(UPDATE_VERSION);

  const updateVersion = async (
    showSetId: string,
    input: {
      versionType: string;
      targetVersion: number;
      reason?: string;
      language: string;
    }
  ) => {
    const result = await mutate({
      variables: { showSetId, input },
    });
    return result.data?.updateVersion ? transformShowSet(result.data.updateVersion) : null;
  };

  return {
    updateVersion,
    loading,
    error,
  };
}

// Hook for session management
export function useSessionMutations() {
  const [startMutation] = useMutation(START_SESSION);
  const [endMutation] = useMutation(END_SESSION);
  const [heartbeatMutation] = useMutation(HEARTBEAT);

  const startSession = async (input: {
    showSetId?: string;
    workingStages?: StageName[];
    activity: string;
  }) => {
    const result = await startMutation({ variables: { input } });
    return result.data?.startSession ?? null;
  };

  const endSession = async () => {
    await endMutation();
  };

  const heartbeat = async (
    showSetId?: string,
    activity?: string,
    workingStages?: StageName[]
  ) => {
    await heartbeatMutation({
      variables: { showSetId, activity, workingStages },
    });
  };

  return {
    startSession,
    endSession,
    heartbeat,
  };
}
