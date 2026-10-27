import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AI_PROVIDER_DETAIL, AI_TERMS_NOTE } from '@/features/coach/aiConsent';
import { AiSharedDataList } from '@/features/coach/AiSharedDataList';
import { Button, Card, ErrorNotice, Icon, Loading, Text, radius, space, useTheme } from '@/ui';

import { formatRelativeTime } from '../../settings/format';
import { NumberedSteps, StatusLine, SuccessHero, type GuideItem } from '../GuideParts';
import type { ClaudeConnect } from './useClaudeConnect';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' });

export const CLAUDE_GUIDE: readonly GuideItem[] = [
  { icon: 'externalLink', text: 'Pulsa «Abrir Claude» e inicia sesión', detail: 'Con tu cuenta de Claude de siempre.' },
  { icon: 'plug', text: 'Conectores › «Añadir conector personalizado»' },
  { icon: 'clipboard', text: 'Nombre: Road to Ironman · URL: pégala', detail: 'Ya la tienes copiada. Luego pulsa «Añadir».' },
  { icon: 'sparkles', text: 'En un chat, pulsa «+» y activa Road to Ironman' },
];

/** (a) Consent before anything reaches the AI provider (names it, the data and how to withdraw it). */
export function ClaudeConsentCard() {
  return (
    <Card padding="lg">
      <View style={styles.wrap}>
        <Text variant="heading">Antes, tu permiso</Text>
        <Text variant="callout">
          {`Tu coach entiende lo que le cuentas con la IA gratuita de ${AI_PROVIDER_DETAIL}. Para ayudarte le enviamos un resumen de:`}
        </Text>
        <AiSharedDataList />
        <Text variant="caption" color="textMuted">
          {`${AI_TERMS_NOTE} Puedes retirar el permiso cuando quieras en Tú › Privacidad.`}
        </Text>
      </View>
    </Card>
  );
}

/** (b) Personal link (copied when fresh), the steps in claude.ai and the live verification status. */
export function ClaudeConnectPanel({ claude, isDemo, showOpenButton = false }: { claude: ClaudeConnect; isDemo: boolean; showOpenButton?: boolean }) {
  const { colors } = useTheme();
  if (claude.checking || (claude.creating && !claude.created)) return <Loading label="Preparando tu enlace" />;
  if (!claude.created && !claude.pending) {
    return claude.error ? (
      <ErrorNotice message={claude.error} onRetry={() => void claude.create()} />
    ) : (
      <Button label="Crear mi enlace" icon="link" size="lg" fullWidth onPress={() => void claude.create()} />
    );
  }
  return (
    <View style={styles.wrapLg}>
      {claude.created ? <LinkBox claude={claude} /> : <PendingLinkBox claude={claude} />}
      <NumberedSteps items={CLAUDE_GUIDE} />
      {showOpenButton ? <Button label="Abrir Claude" icon="externalLink" size="lg" fullWidth onPress={() => void claude.open()} /> : null}
      <StatusLine
        icon="clock"
        busy
        text={isDemo ? 'Modo demo: simulamos que Claude se conecta en unos segundos.' : 'Esperando a que Claude se conecte… te avisamos al momento.'}
      />
      {claude.error ? <ErrorNotice message={claude.error} /> : null}
      {claude.created ? (
        <Pressable accessibilityRole="button" onPress={() => void claude.share()} hitSlop={8} style={styles.link}>
          <Icon name="share" size={16} color={colors.accentInk} />
          <Text variant="callout" color="accentInk">
            ¿Lo haces en el ordenador? Envíate el enlace
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function useInkText(): { ink: string; paper: string; muted: string } {
  const { colors, isDark } = useTheme();
  return {
    ink: isDark ? colors.surfaceAlt : colors.inverseBg,
    paper: isDark ? colors.text : colors.inverseText,
    muted: isDark ? colors.textMuted : colors.inverseText,
  };
}

function LinkBox({ claude }: { claude: ClaudeConnect }) {
  const { colors } = useTheme();
  const { ink, paper, muted } = useInkText();
  const url = claude.created?.url ?? '';
  return (
    <View style={[styles.linkBox, { backgroundColor: ink }]}>
      <View style={styles.linkHead}>
        <Icon name={claude.copied ? 'checkCircle' : 'link'} size={18} color={colors.accent} />
        <Text variant="bodyStrong" style={[styles.flex, { color: paper }]} accessibilityLiveRegion="polite">
          {claude.copied ? 'Copiado. Tu enlace ya está listo para pegar' : 'Tu enlace personal'}
        </Text>
      </View>
      <Text selectable numberOfLines={2} style={[styles.mono, { color: colors.accent, fontFamily: MONO }]} accessibilityLabel={`Tu enlace: ${url}`}>
        {url}
      </Text>
      <View style={styles.linkActions}>
        <Button label={claude.copied ? 'Copiado' : 'Copiar otra vez'} icon={claude.copied ? 'check' : 'copy'} size="sm" variant="secondary" onPress={() => void claude.copy()} />
      </View>
      <Text variant="caption" style={{ color: muted, opacity: 0.75 }}>
        Es como una contraseña: no la compartas con nadie.
      </Text>
    </View>
  );
}

/** A link created earlier and not used yet: its URL is shown only once, so offer a fresh one. */
function PendingLinkBox({ claude }: { claude: ClaudeConnect }) {
  const { colors } = useTheme();
  const { ink, paper, muted } = useInkText();
  const createdAt = claude.pending?.createdAt ?? null;
  return (
    <View style={[styles.linkBox, { backgroundColor: ink }]}>
      <View style={styles.linkHead}>
        <Icon name="link" size={18} color={colors.accent} />
        <Text variant="bodyStrong" style={[styles.flex, { color: paper }]}>
          {`Ya tienes un enlace sin estrenar${createdAt ? ` (creado ${formatRelativeTime(createdAt)})` : ''}`}
        </Text>
      </View>
      <Text variant="callout" style={{ color: muted, opacity: 0.85 }}>
        Por seguridad solo se enseña una vez. Si ya lo pegaste en Claude, termina allí; si no, crea uno nuevo.
      </Text>
      <View style={styles.linkActions}>
        <Button label="Crear enlace nuevo" icon="link" size="sm" variant="secondary" loading={claude.creating} onPress={() => void claude.create()} />
      </View>
    </View>
  );
}

/** (c) Verified: Claude has called our endpoint with the link. */
export function ClaudeConnected({ lastUsedAt }: { lastUsedAt: string | null }) {
  return (
    <SuccessHero
      title="Claude ya ve tu plan"
      message={`Pruébalo: abre Claude y pregúntale «¿Qué toca hoy?».${lastUsedAt ? ` Última conexión ${formatRelativeTime(lastUsedAt)}.` : ''}`}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  wrapLg: { gap: space.lg },
  flex: { flex: 1 },
  linkBox: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  linkHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  linkActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  mono: { fontSize: 13, lineHeight: 19 },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, alignSelf: 'flex-start' },
});
