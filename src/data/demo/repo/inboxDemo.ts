import type { AppNotification, PlanProposal, ProposalDraft, ProposalStatus, UUID } from '@/domain/types';

import { RepositoryError, type Repository } from '../../repository';
import { notify } from '../events';
import { notFound, requireMe, type DemoDeps } from './common';

type InboxMethods = Pick<
  Repository,
  | 'listNotifications'
  | 'markNotificationsRead'
  | 'registerPushToken'
  | 'listProposals'
  | 'getProposal'
  | 'createProposal'
  | 'setProposalStatus'
>;

const PROPOSALS_LIMIT = 50;

export function proposalTitle(count: number): string {
  return count === 1 ? 'Tu semana tiene 1 cambio propuesto' : `Tu semana tiene ${count} cambios propuestos`;
}

export function inboxDemo({ store }: DemoDeps): InboxMethods {
  return {
    async listNotifications(limit = 50): Promise<AppNotification[]> {
      const me = await requireMe(store);
      return (await store.read()).notifications
        .filter((n) => n.userId === me)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },
    async markNotificationsRead(ids: UUID[] | 'all'): Promise<void> {
      const me = await requireMe(store);
      const wanted = ids === 'all' ? null : new Set(ids);
      await store.update((db, clock) => ({
        db: {
          ...db,
          notifications: db.notifications.map((n) =>
            n.userId === me && n.readAt === null && (wanted === null || wanted.has(n.id)) ? { ...n, readAt: clock.now } : n,
          ),
        },
        result: undefined,
      }));
    },
    async registerPushToken(token: string, platform: 'ios' | 'android' | 'web'): Promise<void> {
      if (!token) throw new RepositoryError('validation', 'Token de notificaciones vacío.');
      const me = await requireMe(store);
      await store.update((db, clock) => ({
        db: {
          ...db,
          pushTokens: [...db.pushTokens.filter((t) => t.token !== token), { token, userId: me, platform, lastSeenAt: clock.now }],
        },
        result: undefined,
      }));
    },
    async listProposals(status?: ProposalStatus): Promise<PlanProposal[]> {
      const me = await requireMe(store);
      return (await store.read()).proposals
        .filter((p) => p.userId === me && (!status || p.status === status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, PROPOSALS_LIMIT);
    },
    async getProposal(id: UUID): Promise<PlanProposal | null> {
      const me = await requireMe(store);
      return (await store.read()).proposals.find((p) => p.id === id && p.userId === me) ?? null;
    },
    async createProposal(draft: ProposalDraft): Promise<PlanProposal> {
      const me = await requireMe(store);
      return store.update((db, clock) => {
        const proposal: PlanProposal = {
          ...draft,
          summary: draft.summary.slice(0, 4000),
          model: draft.model ?? null,
          id: clock.newId(),
          userId: me,
          status: 'pending',
          createdAt: clock.now,
        };
        const next = { ...db, proposals: [proposal, ...db.proposals] };
        // Mirrors the DB trigger: only external coaches notify.
        const notified =
          draft.source === 'rules'
            ? next
            : notify(next, me, {
                type: 'plan_updated',
                title: proposalTitle(draft.changes.length),
                body: proposal.summary.trim().slice(0, 300) || 'Tu Claude ha preparado una propuesta. Revísala y acepta lo que te encaje.',
                data: { url: `/proposal/${proposal.id}`, proposalId: proposal.id, source: draft.source },
              }, clock);
        return { db: notified, result: proposal };
      });
    },
    async setProposalStatus(id: UUID, status: ProposalStatus): Promise<void> {
      const me = await requireMe(store);
      await store.update((db) => {
        if (!db.proposals.some((p) => p.id === id && p.userId === me)) throw notFound('Esa propuesta ya no existe.');
        return { db: { ...db, proposals: db.proposals.map((p) => (p.id === id ? { ...p, status } : p)) }, result: undefined };
      });
    },
  };
}
