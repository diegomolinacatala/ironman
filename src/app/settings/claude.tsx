import { useAuth } from '@/data/context';
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
  const generator = useTokenGenerator('mcp', 'Claude');

  return (
    <Screen inSheet>
      <ClaudeHero />
      {isDemo ? (
        <DemoBanner message="Conectar tu Claude necesita el servidor de Rebufo (Supabase). En la demo puedes recorrer el proceso, pero la URL generada no funcionará." />
      ) : null}
      <GenerateUrlStep generator={generator} isDemo={isDemo} />
      <AddConnectorStep />
      <UseItStep />
      <SectionHeader title="URLs activas" />
      <TokenList
        scope="mcp"
        emptyText="Todavía no has generado ninguna URL."
        revokeMessage="Tu Claude dejará de poder acceder a Rebufo con esta URL. Tendrás que generar otra y cambiarla en el conector."
      />
      <CoachDifferenceCard />
      <PrivacyLinkRow title="Privacidad y Coach IA" subtitle="Da o retira el permiso para compartir tus datos con Anthropic" />
    </Screen>
  );
}
