import { StyleSheet, View } from 'react-native';

import { COROS_CLAUDE_NOTE, COROS_HEALTH_STEPS, COROS_PERMISSION_CHECKS } from '@/features/settings/corosContent';
import { openCorosApp, openCorosGuide } from '@/features/settings/corosLinks';
import { SIMULATED_COROS_MESSAGE, corosImportView } from '@/features/settings/corosModel';
import { Button, Card, ErrorNotice, Icon, Text, iconSize, radius, space, useTheme } from '@/ui';

import { NumberedSteps, StatusLine, SuccessHero } from '../GuideParts';
import type { CorosConnect } from './useCorosConnect';

/** The three steps in the COROS app, what Claude adds and the complete guide. */
export function CorosGuideIntro({ error }: { error: string | null }) {
  return (
    <View style={styles.wrap}>
      <NumberedSteps items={COROS_HEALTH_STEPS} />
      <StatusLine icon="sparkles" text={COROS_CLAUDE_NOTE} />
      {error ? <ErrorNotice message={error} /> : null}
      <GuideLink />
    </View>
  );
}

function GuideLink() {
  return <Button label="Ver la guía completa" variant="ghost" size="sm" icon="info" onPress={openCorosGuide} style={styles.start} />;
}

/** Apple Salud on: «COROS conectado» with what came, or «Aún no vemos datos de COROS». */
export function CorosImported({ coros }: { coros: CorosConnect }) {
  if (coros.phase === 'simulated') {
    return (
      <SuccessHero title="COROS conectado" message={SIMULATED_COROS_MESSAGE}>
        <StatusLine icon="sparkles" text={COROS_CLAUDE_NOTE} />
      </SuccessHero>
    );
  }
  const view = corosImportView(coros.result, coros.known);
  if (view.kind === 'seen') {
    return (
      <SuccessHero title={view.title} message={view.message}>
        <Text variant="caption" color="textMuted">
          Por Apple Salud. Llega solo cada vez que la app COROS sincroniza tu reloj.
        </Text>
        <StatusLine icon="sparkles" text={COROS_CLAUDE_NOTE} />
      </SuccessHero>
    );
  }
  return <CorosWaiting title={view.title} message={view.message} error={coros.error} />;
}

/** Nothing from COROS yet: normal at first. What to do and where the permissions live. */
function CorosWaiting({ title, message, error }: { title: string; message: string; error: string | null }) {
  const { colors } = useTheme();
  return (
    <Card padding="lg" style={styles.wrap}>
      <View style={styles.head} accessible accessibilityRole="summary" accessibilityLiveRegion="polite">
        <Icon name="clock" size={iconSize.md} color={colors.warning} />
        <Text variant="heading" style={styles.flex}>
          {title}
        </Text>
      </View>
      <Text variant="callout" color="textMuted">
        {message}
      </Text>
      <View style={[styles.well, { backgroundColor: colors.surfaceAlt }]}>
        <Text variant="caption" color="textMuted">
          Si tras sincronizar sigue sin llegar, revisa los permisos en la app Salud:
        </Text>
        {COROS_PERMISSION_CHECKS.map((line) => (
          <Text key={line} variant="caption">
            {`· ${line}`}
          </Text>
        ))}
      </View>
      <StatusLine icon="checkCircle" tone="success" text="Apple Salud ya está conectado: puedes seguir y tus datos llegarán solos." />
      {error ? <ErrorNotice message={error} /> : null}
      <View style={styles.actions}>
        <Button label="Abrir la app COROS" variant="secondary" size="sm" icon="externalLink" onPress={() => void openCorosApp()} />
        <GuideLink />
      </View>
    </Card>
  );
}

/** Signed in on the web: COROS reaches us through Apple Salud, on the iPhone. */
export function CorosOnlyOnIphone() {
  const { colors } = useTheme();
  return (
    <Card padding="lg" style={styles.wrap}>
      <View style={styles.head}>
        <Icon name="phone" size={iconSize.md} color={colors.textMuted} />
        <Text variant="heading" style={styles.flex}>
          Solo en el iPhone
        </Text>
      </View>
      <Text variant="callout" color="textMuted">
        Tu COROS llega por Apple Salud, y eso solo funciona en la app del iPhone. Sigue sin reloj y conéctalo desde el iPhone en
        Tú › Conexiones.
      </Text>
      <StatusLine icon="sparkles" text="Mientras, tu Claude con COROS puede guardar tu VFC, tu sueño y tus entrenos (siguiente paso)." />
      <GuideLink />
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  well: { borderRadius: radius.md, padding: space.md, gap: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  start: { alignSelf: 'flex-start' },
});
