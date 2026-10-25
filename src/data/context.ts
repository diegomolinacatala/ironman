import { createContext, useContext } from 'react';

import type { AuthSession, Repository } from './repository';

export interface AuthState {
  session: AuthSession | null;
  /** True until the persisted session has been restored. */
  isLoading: boolean;
}

export const RepositoryContext = createContext<Repository | null>(null);
export const AuthContext = createContext<AuthState>({ session: null, isLoading: true });

export function useRepository(): Repository {
  const repository = useContext(RepositoryContext);
  if (!repository) throw new Error('useRepository must be used inside <RepositoryProvider>');
  return repository;
}

export function useAuth(): AuthState & { auth: Repository['auth']; mode: Repository['mode'] } {
  const repository = useRepository();
  const state = useContext(AuthContext);
  return { ...state, auth: repository.auth, mode: repository.mode };
}
