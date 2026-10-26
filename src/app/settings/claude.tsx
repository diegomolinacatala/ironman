import { useAuth } from '@/data/context';
import { isAiCoachEnabled } from '@/features/coach/aiCoachFlag';
import { ClaudeHero } from '@/features/settings/ClaudeHero';
import {
  AddConnectorStep,
  CoachDifferenceCard,
  GenerateUrlStep,
  UseItStep,
} from '@/features/settings/ClaudeConnectGuide';
import { DemoBanner } from '@/features/account/DemoBanner';
import { PrivacyLinkRow } from '@/features/settings/PrivacyLinkRow';
import { TokenList } from '@/features/settings/TokenList';
import { useTokenGenerator } from '@/features/settings/useTokenGenerator';
import { Screen, SectionHeader } from '@/ui';

export default function ConnectClaudeScreen() {
  const { mode } = useAuth();
  const isDemo = mode === 'demo';
  const aiCoach = isAiCoachEnabled();
  const generator = useTokenGenerator('mcp', 'Claude');

  return (
    <Screen inSheet>
      <ClaudeHero />
      {isDemo ? (
        <DemoBanner message="Conectar tu Claude necesita el servidor de Road to Ironman (Supabase). En la demo puedes recorrer el proceso, pero la URL generada no funcionará." />
      ) : null}
      <GenerateUrlStep generator={generator} isDemo={isDemo} />
      <AddConnectorStep />
      <UseItStep />
      <SectionHeader title="URLs activas" />
      <TokenList
        scope="mcp"
        emptyText="Todavía no has generado ninguna URL."
        revokeMessage="Tu Claude dejará de poder acceder a Road to Ironman con esta URL. Tendrás que generar otra y cambiarla en el conector."
      />
      {/* The comparison with the in-app Coach IA only makes sense while it is switched on. */}
      {aiCoach ? <CoachDifferenceCard /> : null}
      {aiCoach ? (
        <PrivacyLinkRow title="Privacidad y Coach IA" subtitle="Da o retira el permiso para compartir tus datos con Anthropic" />
      ) : (
        <PrivacyLinkRow title="Privacidad" subtitle="Qué ve tu Claude y quién más ve tus datos" />
      )}
    </Screen>
  );
}
