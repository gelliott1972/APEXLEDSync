import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { signIn, signOut, getCurrentUser, fetchUserAttributes } from 'aws-amplify/auth';
import type { UserRole, Language } from '@unisync/shared-types';

interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  preferredLang: Language;
  canEditVersions: boolean;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  // Role switching for testing (grant@candelic.com only)
  roleOverride: UserRole | null;
  showRoleSwitcher: boolean;
  effectiveRole: () => UserRole | undefined;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
  clearError: () => void;
  setRoleOverride: (role: UserRole | null) => void;
  setShowRoleSwitcher: (show: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,
      roleOverride: null,
      showRoleSwitcher: false,
      effectiveRole: () => {
        const state = get();
        if (state.user?.email === 'grant@candelic.com' && state.roleOverride) {
          return state.roleOverride;
        }
        return state.user?.role;
      },

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          console.log('Attempting login for:', email);
          const result = await signIn({ username: email, password });
          console.log('Sign in result:', result);
          const attributes = await fetchUserAttributes();
          console.log('User attributes:', attributes);

          const role = (attributes['custom:role'] as UserRole) ?? 'viewer';
          const user: AuthUser = {
            userId: attributes['custom:userId'] ?? attributes.sub ?? '',
            email: attributes.email ?? email,
            name: attributes.name ?? email,
            role,
            preferredLang: (attributes['custom:preferredLang'] as Language) ?? 'en',
            canEditVersions: attributes['custom:canEditVersions'] === 'true',
          };

          set({ user, isAuthenticated: true, isLoading: false });
        } catch (err) {
          console.error('Login error:', err);
          set({
            error: err instanceof Error ? err.message : 'Login failed',
            isLoading: false,
          });
          throw err;
        }
      },

      logout: async () => {
        try {
          await signOut();
        } finally {
          set({ user: null, isAuthenticated: false });
        }
      },

      checkAuth: async () => {
        set({ isLoading: true });
        try {
          await getCurrentUser();
          const attributes = await fetchUserAttributes();

          const role = (attributes['custom:role'] as UserRole) ?? 'viewer';
          const user: AuthUser = {
            userId: attributes['custom:userId'] ?? attributes.sub ?? '',
            email: attributes.email ?? '',
            name: attributes.name ?? '',
            role,
            preferredLang: (attributes['custom:preferredLang'] as Language) ?? 'en',
            canEditVersions: attributes['custom:canEditVersions'] === 'true',
          };

          set({ user, isAuthenticated: true, isLoading: false });
        } catch {
          set({ user: null, isAuthenticated: false, isLoading: false });
        }
      },

      setUser: (user) => set({ user, isAuthenticated: !!user }),
      clearError: () => set({ error: null }),
      setRoleOverride: (role) => set({ roleOverride: role }),
      setShowRoleSwitcher: (show) => set({ showRoleSwitcher: show, roleOverride: show ? null : null }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        showRoleSwitcher: state.showRoleSwitcher,
        roleOverride: state.roleOverride,
      }),
    }
  )
);
