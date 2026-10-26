/**
 * Demo auth: any email + any 6-digit code signs in as the seeded athlete;
 * Apple sign-in is simulated on every platform.
 */
import { RepositoryError, type AuthApi, type AuthSession } from '../repository';
import type { DemoStore } from './store';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;

export function createDemoAuth(store: DemoStore): AuthApi {
  async function signInAs(email: string | null): Promise<AuthSession> {
    const db = await store.read();
    const session: AuthSession = { userId: db.meId, email };
    await store.setSession(session);
    return session;
  }

  return {
    getSession: () => store.getSession(),
    onAuthChange: (listener) => store.onAuthChange(listener),

    async sendEmailCode(email) {
      if (!EMAIL_RE.test(email.trim())) throw new RepositoryError('validation', 'Ese email no parece válido.');
    },

    async verifyEmailCode(email, code) {
      if (!CODE_RE.test(code.replace(/\s/g, ''))) {
        throw new RepositoryError('validation', 'El código tiene 6 dígitos (en modo demo vale cualquiera).');
      }
      return signInAs(email.trim().toLowerCase());
    },

    completeEmailLink: () => signInAs('diego@roadtoironman.app'),

    signInWithApple: () => signInAs('diego@privaterelay.appleid.com'),

    async signOut() {
      await store.flush();
      await store.setSession(null);
    },

    async deleteAccount() {
      await store.wipe();
      await store.setSession(null);
    },
  };
}
