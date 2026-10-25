import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { removeKey, StorageKeys } from '@/lib/storage';

import { AuthContext, RepositoryContext, type AuthState } from './context';
import { createRepository } from './createRepository';
import { useRealtimeInvalidation } from './queries';
import type { Repository } from './repository';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

// React Native has no window focus events: refetch stale queries when the app comes back to the foreground.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (state) => setFocused(state === 'active'));
    return () => subscription.remove();
  });
}

function RealtimeBridge() {
  useRealtimeInvalidation();
  return null;
}

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [repository] = useState<Repository>(() => createRepository());
  const [auth, setAuth] = useState<AuthState>({ session: null, isLoading: true });

  useEffect(() => {
    let active = true;
    repository.auth
      .getSession()
      .then((session) => {
        if (active) setAuth({ session, isLoading: false });
      })
      .catch(() => {
        if (active) setAuth({ session: null, isLoading: false });
      });
    const unsubscribe = repository.auth.onAuthChange((session) => {
      setAuth({ session, isLoading: false });
      if (!session) {
        queryClient.clear();
        // Per-device chat history must not leak to the next account on this phone.
        void removeKey(StorageKeys.coachHistory);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [repository]);

  return (
    <RepositoryContext.Provider value={repository}>
      <AuthContext.Provider value={auth}>
        <QueryClientProvider client={queryClient}>
          {auth.session ? <RealtimeBridge /> : null}
          {children}
        </QueryClientProvider>
      </AuthContext.Provider>
    </RepositoryContext.Provider>
  );
}

export { useAuth, useRepository } from './context';
