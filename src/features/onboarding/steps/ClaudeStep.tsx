import { useState } from 'react';

import { useUpdateProfile } from '@/data/queries';
import type { CreatedToken, Profile } from '@/domain/types';
import { isAiCoachEnabled } from '@/features/coach/aiCoachFlag';
import { errorMessage, logger } from '@/lib/logger';
import { ErrorNotice, haptics } from '@/ui';

import { confirmAction } from '../../settings/confirm';
import { Appear } from '../Appear';
import { ClaudeConnected, ClaudeConnectPanel, ClaudeConsentCard } from '../claude/ClaudeParts';
import { reusableClaudeTokenForOnboarding } from '../connectModel';
import { useAutoCreateLink, useClaudeConnect, type ClaudeConnect } from '../claude/useClaudeConnect';
import { StepLayout, type StepAction, type StepNav } from '../StepLayout';

export interface ClaudeStepProps {
  nav: StepNav;
  profile: Profile;
  isDemo: boolean;
  /** Token created in this onboarding session (kept by the flow across steps). */
  token: CreatedToken | null;
  onToken: (token: CreatedToken) => void;
  /** Id of the link this onboarding created before (persisted, e.g. across an app restart). */
  storedTokenId: string | null;
  /** Already connected or skipped earlier (the athlete came back): skipping is offered right away. */
  done: boolean;
  /** Claude connected or skipped: the flow records it and moves on. */
  onDone: () => void;
}

/**
 * Step 4 (required): (a) consent to share data with the AI provider (Cloudflare), (b) create +
 * copy the personal connector URL and open claude.ai, (c) live verification
 * until THIS link is used. "Saltar por ahora" appears after 45 s.
 */
export function ClaudeStep({ nav, profile, isDemo, token, onToken, storedTokenId, done, onDone }: ClaudeStepProps) {
  const update = useUpdateProfile();
  const [consented, setConsented] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const needsConsent = isAiCoachEnabled() && !profile.aiConsentAt && !consented;
  const claude = useClaudeConnect({
    created: token,
    onCreated: onToken,
    // A link minted < 10 min ago (app killed meanwhile) is waited on, not minted again.
    reuse: (tokens) => reusableClaudeTokenForOnboarding(tokens, storedTokenId),
    active: !needsConsent,
  });

  useAutoCreateLink(claude, !needsConsent);

  const accept = async () => {
    setConsentError(null);
    try {
      await update.mutateAsync({ aiConsentAt: new Date().toISOString() });
      haptics.success();
      setConsented(true);
    } catch (err) {
      logger.warn('onboarding: ai consent failed', err);
      setConsentError(errorMessage(err, 'No hemos podido guardar tu permiso. Inténtalo de nuevo.'));
    }
  };

  const decline = async () => {
    const ok = await confirmAction({
      title: '¿Seguir sin IA?',
      message:
        'Sin tu permiso, tu coach usará reglas sencillas y no podrás hablar con Claude de tu plan. Puedes darlo cuando quieras en Tú › Privacidad.',
      confirmLabel: 'Seguir sin IA',
      cancelLabel: 'Volver',
    });
    if (ok) onDone();
  };

  if (needsConsent) {
    return (
      <StepLayout
        nav={nav}
        busy={update.isPending}
        primary={{ label: 'Acepto', icon: 'check', onPress: () => void accept(), loading: update.isPending }}
        secondary={{ label: 'Ahora no', onPress: () => void decline(), disabled: update.isPending }}>
        <Appear index={1}>
          <ClaudeConsentCard />
        </Appear>
        {consentError ? <ErrorNotice message={consentError} /> : null}
      </StepLayout>
    );
  }

  return (
    <StepLayout nav={nav} busy={claude.creating} primary={primaryFor(claude, onDone)} secondary={secondaryFor(claude, done, onDone)}>
      <Appear index={1}>
        {claude.link === 'connected' ? (
          <ClaudeConnected lastUsedAt={claude.lastUsedAt} />
        ) : (
          <ClaudeConnectPanel claude={claude} isDemo={isDemo} />
        )}
      </Appear>
    </StepLayout>
  );
}

function primaryFor(claude: ClaudeConnect, onDone: () => void): StepAction {
  if (claude.link === 'connected') return { label: 'Continuar', iconRight: 'arrowRight', onPress: onDone };
  return {
    label: 'Abrir Claude',
    icon: 'externalLink',
    onPress: () => void claude.open(),
    disabled: !claude.created && !claude.pending,
    loading: claude.creating,
  };
}

function secondaryFor(claude: ClaudeConnect, done: boolean, onDone: () => void): StepAction | null {
  if (claude.link === 'connected') return null;
  // A link that cannot be created (server down) must not trap the athlete either.
  const stuck = Boolean(claude.error) && !claude.created && !claude.pending;
  return claude.canSkip || stuck || done ? { label: 'Saltar por ahora', onPress: onDone } : null;
}
