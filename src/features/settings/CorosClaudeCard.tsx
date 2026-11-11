import { StyleSheet, View } from 'react-native';

import { Card, Text, fonts, radius, space, useTheme } from '@/ui';

import { NumberedSteps } from '../onboarding/GuideParts';
import { COROS_CLAUDE_PROMPTS, COROS_CLAUDE_STEPS, COROS_MCP_EU_URL, COROS_MCP_URL, COROS_PERMISSIONS } from './corosContent';
import { CopyValue } from './CopyValue';
import { PromptList } from './PromptList';
import { useCopy } from './useCopy';

export interface CorosClaudeCardProps {
  /** Example prompts (once Road to Ironman is connected to Claude). */
  showPrompts?: boolean;
}

/**
 * "Añade también COROS a tu Claude" (optional): the official connector, the custom-URL
 * fallback, how to set its permissions and what to ask. Claude reads HRV, sleep,
 * recovery and load from COROS and saves them here.
 */
export function CorosClaudeCard({ showPrompts = false }: CorosClaudeCardProps) {
  return (
    <Card padding="lg" style={styles.card}>
      <View style={styles.block}>
        <Text variant="overline" color="textMuted">
          Opcional · recomendado
        </Text>
        <Text variant="heading" accessibilityRole="header">
          Añade también COROS a tu Claude
        </Text>
        <Text variant="callout" color="textMuted">
          Así tu Claude lee tu VFC, tu sueño, tu recuperación y tu carga de COROS, los guarda aquí y pasa tus entrenos de carrera
          y bici a tu reloj.
        </Text>
      </View>
      <NumberedSteps items={COROS_CLAUDE_STEPS} />
      <CustomConnector />
      <ConnectorPermissions />
      {showPrompts ? (
        <View style={styles.block}>
          <Text variant="heading" accessibilityRole="header">
            Pídeselo así
          </Text>
          <PromptList prompts={COROS_CLAUDE_PROMPTS} />
        </View>
      ) : null}
    </Card>
  );
}

/** Not listed under "Explorar conectores": «Añadir conector personalizado» with COROS's URL. */
export function CustomConnector() {
  const clipboard = useCopy();
  return (
    <View style={styles.block}>
      <Text variant="bodyStrong">¿No aparece COROS?</Text>
      <Text variant="callout" color="textMuted">
        Pulsa «Añadir conector personalizado», llámalo COROS y pega esta URL. Si falla, prueba la de Europa.
      </Text>
      <CopyValue value={COROS_MCP_URL} clipboard={clipboard} />
      <CopyValue label="Europa" value={COROS_MCP_EU_URL} clipboard={clipboard} />
      {clipboard.error ? (
        <Text variant="caption" color="danger">
          {clipboard.error}
        </Text>
      ) : null}
    </View>
  );
}

/** Read always, workouts with your approval, COROS plans blocked (the plan lives here). */
export function ConnectorPermissions() {
  const { colors } = useTheme();
  return (
    <View style={styles.block}>
      <Text variant="bodyStrong">Permisos del conector</Text>
      <View style={[styles.well, { backgroundColor: colors.surfaceAlt }]} accessibilityRole="list">
        {COROS_PERMISSIONS.map((permission) => (
          <View key={permission.label} style={styles.permission} accessible accessibilityLabel={`${permission.label}: ${permission.value}. ${permission.why}`}>
            <View style={styles.permissionHead}>
              <Text variant="callout" style={styles.flex}>
                {permission.label}
              </Text>
              <Text variant="callout" color="accentInk" style={styles.value}>
                {permission.value}
              </Text>
            </View>
            <Text variant="caption" color="textMuted">
              {permission.why}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
  block: { gap: space.sm },
  well: { borderRadius: radius.md, padding: space.md, gap: space.md },
  permission: { gap: 2 },
  permissionHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
  value: { fontFamily: fonts.bodySemibold },
});
