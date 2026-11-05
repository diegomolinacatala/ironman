import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { isAiCoachEnabled } from '@/features/coach/aiCoachFlag';
import { Card, ListRow, space } from '@/ui';

export interface PrivacyLinkRowProps {
  title?: string;
  subtitle?: string;
}

function defaultSubtitle(): string {
  return isAiCoachEnabled() ? 'Qué datos usamos, con quién y el permiso del Coach IA' : 'Qué datos usamos y con quién';
}

/** Row that opens the Privacidad screen (policy summary + Coach IA permission when the AI coach is on). */
export function PrivacyLinkRow({ title = 'Política de privacidad', subtitle = defaultSubtitle() }: PrivacyLinkRowProps) {
  return (
    <Card padding={0} style={styles.card}>
      <ListRow icon="lock" title={title} subtitle={subtitle} onPress={() => router.push('/privacy')} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: space.md, paddingVertical: space.xs },
});
