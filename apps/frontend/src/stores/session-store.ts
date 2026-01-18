import { create } from 'zustand';
import { sessionsApi } from '../lib/api';
import { HEARTBEAT_INTERVAL_MS } from '@unisync/shared-types';
import type { StageName } from '@unisync/shared-types';

interface SessionState {
  isWorking: boolean;
  currentShowSetId: string | null;
  workingStages: StageName[];
  activity: string;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  startSession: (showSetId?: string, stages?: StageName[], activity?: string) => Promise<void>;
  endSession: () => Promise<StageName[]>;
  updateActivity: (showSetId?: string, activity?: string) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  isWorking: false,
  currentShowSetId: null,
  workingStages: [],
  activity: '',
  heartbeatInterval: null,

  startSession: async (showSetId?: string, stages: StageName[] = [], activity = 'Working') => {
    try {
      await sessionsApi.start({ showSetId, workingStages: stages, activity });

      // Start heartbeat interval
      const interval = setInterval(async () => {
        const state = get();
        if (state.isWorking) {
          try {
            await sessionsApi.heartbeat(
              state.currentShowSetId ?? undefined,
              state.activity,
              state.workingStages
            );
          } catch (err) {
            console.error('Heartbeat failed:', err);
          }
        }
      }, HEARTBEAT_INTERVAL_MS);

      set({
        isWorking: true,
        currentShowSetId: showSetId ?? null,
        workingStages: stages,
        activity,
        heartbeatInterval: interval,
      });
    } catch (err) {
      console.error('Failed to start session:', err);
      throw err;
    }
  },

  endSession: async () => {
    const { heartbeatInterval, workingStages } = get();

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }

    try {
      await sessionsApi.end();
    } catch (err) {
      console.error('Failed to end session:', err);
    }

    // Save working stages before clearing
    const stagesWorkedOn = [...workingStages];

    set({
      isWorking: false,
      currentShowSetId: null,
      workingStages: [],
      activity: '',
      heartbeatInterval: null,
    });

    return stagesWorkedOn;
  },

  updateActivity: (showSetId?: string, activity?: string) => {
    set((state) => ({
      currentShowSetId: showSetId ?? state.currentShowSetId,
      activity: activity ?? state.activity,
    }));
  },
}));

// Clean up session on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const { isWorking, endSession } = useSessionStore.getState();
    if (isWorking) {
      endSession();
    }
  });
}
