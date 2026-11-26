import type { AppNotification, PlanProposal, ProposalDraft, ProposalStatus, UUID } from '@/domain/types';

import { RepositoryError, type Repository } from '../repository';
import { run, runOne, runVoid, type SupabaseCtx } from './base';
import { proposalDraftToInsert, rowToNotification, rowToProposal } from './mappers';
import type { NotificationRow, ProposalRow } from './rows';

type InboxMethods = Pick<
  Repository,
  | 'listNotifications'
  | 'markNotificationsRead'
  | 'registerPushToken'
  | 'listProposals'
  | 'getProposal'
  | 'createProposal'
  | 'setProposalStatus'
> &
  Required<Pick<Repository, 'claimWakeBriefing'>>;

const PROPOSALS_LIMIT = 50;

export function inboxApi(ctx: SupabaseCtx): InboxMethods {
  const { client } = ctx;

  async function listNotifications(limit = 50): Promise<AppNotification[]> {
    const me = await ctx.userId();
    const rows = await run<NotificationRow[] | null>(
      'listNotifications',
      client
        .from('notifications')
        .select('id,user_id,type,title,body,data,read_at,created_at')
        .eq('user_id', me)
        .order('created_at', { ascending: false })
        .limit(limit),
    );
    return (rows ?? []).map(rowToNotification);
  }

  async function markNotificationsRead(ids: UUID[] | 'all'): Promise<void> {
    if (ids !== 'all' && ids.length === 0) return;
    await runVoid(
      'markNotificationsRead',
      client.rpc('mark_notifications_read', { p_ids: ids === 'all' ? null : ids }),
    );
  }

  async function registerPushToken(token: string, platform: 'ios' | 'android' | 'web'): Promise<void> {
    if (!token) throw new RepositoryError('validation', 'Token de notificaciones vacío.');
    await runVoid('registerPushToken', client.rpc('register_push_token', { p_token: token, p_platform: platform }));
  }

  /** claim_wake_briefing (20261126000300_wake_notification.sql): true when this device takes today's briefing. */
  async function claimWakeBriefing(input: { date: string; sleepEnd: string; dueAt: string }): Promise<boolean> {
    const data = await run<unknown>(
      'claimWakeBriefing',
      client.rpc('claim_wake_briefing', { p_date: input.date, p_sleep_end: input.sleepEnd, p_due_at: input.dueAt }),
    );
    return data === true;
  }

  async function listProposals(status?: ProposalStatus): Promise<PlanProposal[]> {
    const me = await ctx.userId();
    const base = client.from('plan_proposals').select('*').eq('user_id', me);
    const filtered = status ? base.eq('status', status) : base;
    const rows = await run<ProposalRow[] | null>(
      'listProposals',
      filtered.order('created_at', { ascending: false }).limit(PROPOSALS_LIMIT),
    );
    return (rows ?? []).map(rowToProposal);
  }

  async function getProposal(id: UUID): Promise<PlanProposal | null> {
    const row = await run<ProposalRow | null>(
      'getProposal',
      client.from('plan_proposals').select('*').eq('id', id).maybeSingle(),
    );
    return row ? rowToProposal(row) : null;
  }

  async function createProposal(draft: ProposalDraft): Promise<PlanProposal> {
    const me = await ctx.userId();
    const row = await runOne<ProposalRow>(
      'createProposal',
      client.from('plan_proposals').insert(proposalDraftToInsert(draft, me)).select('*').single(),
      'No se ha podido guardar la propuesta.',
    );
    return rowToProposal(row);
  }

  async function setProposalStatus(id: UUID, status: ProposalStatus): Promise<void> {
    await runVoid(
      'setProposalStatus',
      client.from('plan_proposals').update({ status, updated_at: ctx.now() }).eq('id', id),
    );
  }

  return {
    listNotifications,
    markNotificationsRead,
    registerPushToken,
    claimWakeBriefing,
    listProposals,
    getProposal,
    createProposal,
    setProposalStatus,
  };
}
