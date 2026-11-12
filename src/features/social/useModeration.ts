/**
 * Report and block another user (App Store guideline 1.2). Every place that shows someone
 * else's content (friend screen, friend request, quedada message) offers both actions.
 */
import { useBlockUser, useReportUser } from '@/data/queries';
import type { ReportContext, ReportReason, UUID } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';

import { confirmAction, showActionMenu, showNotice, type MenuAction } from './confirm';

export interface ModerationTarget {
  userId: UUID;
  displayName: string;
}

export const REPORT_REASON_LABELS: Readonly<Record<ReportReason, string>> = {
  harassment: 'Acoso o insultos',
  inappropriate: 'Contenido inapropiado',
  spam: 'Spam o publicidad',
  other: 'Otro motivo',
};

const REASONS = Object.keys(REPORT_REASON_LABELS) as ReportReason[];

export interface Moderation {
  /** Asks for confirmation, blocks and calls `onBlocked` (e.g. leave the friend screen). */
  block(target: ModerationTarget, onBlocked?: () => void): Promise<void>;
  /** Asks for a reason and sends the report. */
  report(target: ModerationTarget, context: ReportContext, targetId?: UUID | null): void;
  /** "Denunciar" + "Bloquear" menu entries, after `extra`. */
  actions(target: ModerationTarget, context: ReportContext, opts?: { targetId?: UUID | null; onBlocked?: () => void }): MenuAction[];
}

export function useModeration(): Moderation {
  const blockUser = useBlockUser();
  const reportUser = useReportUser();

  const block: Moderation['block'] = async (target, onBlocked) => {
    const ok = await confirmAction({
      title: `¿Bloquear a ${target.displayName}?`,
      message: 'Dejaréis de ser amigos, no verá tu calendario y no podrá volver a enviarte solicitudes.',
      confirmLabel: 'Bloquear',
      destructive: true,
    });
    if (!ok) return;
    try {
      await blockUser.mutateAsync(target.userId);
      showNotice(`Has bloqueado a ${target.displayName}`);
      onBlocked?.();
    } catch (error) {
      logger.warn('block user failed', error);
      showNotice('No se ha podido bloquear', errorMessage(error));
    }
  };

  const send = async (target: ModerationTarget, reason: ReportReason, context: ReportContext, targetId: UUID | null) => {
    try {
      await reportUser.mutateAsync({ userId: target.userId, reason, context, targetId });
      showNotice('Gracias por avisar', 'Revisamos cada denuncia en menos de 24 horas. Si no quieres saber nada más de esta persona, bloquéala.');
    } catch (error) {
      logger.warn('report user failed', error);
      showNotice('No se ha podido enviar la denuncia', errorMessage(error));
    }
  };

  const report: Moderation['report'] = (target, context, targetId = null) => {
    showActionMenu(
      `¿Por qué denuncias a ${target.displayName}?`,
      REASONS.map((reason) => ({ label: REPORT_REASON_LABELS[reason], onSelect: () => void send(target, reason, context, targetId) })),
    );
  };

  const actions: Moderation['actions'] = (target, context, opts = {}) => [
    { label: 'Denunciar', onSelect: () => report(target, context, opts.targetId ?? null) },
    { label: 'Bloquear', destructive: true, onSelect: () => void block(target, opts.onBlocked) },
  ];

  return { block, report, actions };
}
