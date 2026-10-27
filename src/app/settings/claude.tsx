import { useState } from 'react';

import { useAuth } from '@/data/context';
import type { CreatedToken } from '@/domain/types';
import { isAiCoachEnabled } from '@/features/coach/aiCoachFlag';
import { ClaudeConnected, ClaudeConnectPanel } from '@/features/onboarding/claude/ClaudeParts';
import { useClaudeConnect } from '@/features/onboarding/claude/useClaudeConnect';
import { reusableClaudeTokenForSettings } from '@/features/onboarding/connectModel';
import { ClaudeHero } from '@/features/settings/ClaudeHero';
import { CoachDifferenceCard } from '@/features/settings/ClaudeConnectGuide';
import { PrivacyLinkRow } from '@/features/settings/PrivacyLinkRow';
import { PromptList } from '@/features/settings/PromptList';
import { TokenList } from '@/features/settings/TokenList';
import { Button, Screen, SectionHeader } from '@/ui';

/** "Conecta tu Claude": the same connect + live verification as the onboarding step, plus link management. */
export default function ConnectClaudeScreen() {
  const { mode } = useAuth();
  const isDemo = mode === 'demo';
  const aiCoach = isAiCoachEnabled();
  const [token, setToken] = useState<CreatedToken | null>(null);
  // Never mint a link per visit: wait on the latest unused one; "Crear enlace nuevo" is explicit.
  const claude = useClaudeConnect({ created: token, onCreated: setToken, reuse: reusableClaudeTokenForSettings, active: true });

  return (
    <Screen inSheet>
      <ClaudeHero />
      {claude.link === 'connected' ? (
        <>
          <ClaudeConnected lastUsedAt={claude.lastUsedAt} />
          <SectionHeader title="Pídeselo así" />
          <PromptList />
          <Button
            label="Conectar otra cuenta de Claude"
            icon="link"
            variant="secondary"
            fullWidth
            loading={claude.creating}
            onPress={() => void claude.create()}
          />
        </>
      ) : (
        <ClaudeConnectPanel claude={claude} isDemo={isDemo} showOpenButton />
      )}
      <SectionHeader title="Enlaces activos" />
      <TokenList
        scope="mcp"
        emptyText="Todavía no tienes ningún enlace."
        revokeMessage="Tu Claude dejará de poder acceder a Road to Ironman con este enlace. Tendrás que crear otro y cambiarlo en el conector."
      />
      {/* The comparison with the in-app Coach IA only makes sense while it is switched on. */}
      {aiCoach ? <CoachDifferenceCard /> : null}
      {aiCoach ? (
        <PrivacyLinkRow title="Privacidad y Coach IA" subtitle="Da o retira el permiso para que la IA del coach lea tus datos" />
      ) : (
        <PrivacyLinkRow title="Privacidad" subtitle="Qué ve tu Claude y quién más ve tus datos" />
      )}
    </Screen>
  );
}
