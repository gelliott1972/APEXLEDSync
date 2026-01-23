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
  restoreSession: () => Promise<void>;
  startHeartbeat: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  isWorking: false,
  currentShowSetId: null,
  workingStages: [],
  activity: '',
  heartbeatInterval: null,

  startHeartbeat: () => {
    const { heartbeatInterval } = get();
    // Clear any existing interval
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }

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

    set({ heartbeatInterval: interval });
  },

  restoreSession: async () => {
    try {
      const sessions = await sessionsApi.myActive();
      if (sessions.length > 0) {
        const active = sessions[0];
        set({
          isWorking: true,
          currentShowSetId: active.showSetId ?? null,
          workingStages: active.workingStages || [],
          activity: active.activity || '',
        });
        // Start heartbeat for restored session
        get().startHeartbeat();
      }
    } catch (err) {
      console.error('Failed to restore session:', err);
    }
  },

  startSession: async (showSetId?: string, stages: StageName[] = [], activity = 'Working') => {
    try {
      await sessionsApi.start({ showSetId, workingStages: stages, activity });

      set({
        isWorking: true,
        currentShowSetId: showSetId ?? null,
        workingStages: stages,
        activity,
      });

      // Start heartbeat
      get().startHeartbeat();
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

// Note: We intentionally do NOT end the session on beforeunload/refresh.
// The session will be restored from the backend on page load via restoreSession().
// Sessions have a 5-minute TTL and are kept alive by heartbeat.
