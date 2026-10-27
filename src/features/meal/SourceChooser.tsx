import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { FadeIn } from '@/features/talk/motion';
import { needsSettings } from '@/features/talk/voiceModel';
import { Button, Icon, Text, haptics, radius, space, useTheme, type IconName } from '@/ui';

function SourceOption({ icon, title, subtitle, onPress, index }: { icon: IconName; title: string; subtitle: string; onPress: () => void; index: number }) {
  const { colors } = useTheme();
  return (
    <FadeIn index={index}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${subtitle}`}
        onPress={() => {
          haptics.tap();
          onPress();
        }}
        style={({ pressed }) => [
          styles.option,
          { backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: colors.border },
        ]}>
        <View style={[styles.icon, { backgroundColor: colors.surfaceAlt }]}>
          <Icon name={icon} size={22} color={colors.text} />
        </View>
        <View style={styles.text}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="caption" color="textMuted">
            {subtitle}
          </Text>
        </View>
        <Icon name="chevronRight" size={14} color={colors.textFaint} />
      </Pressable>
    </FadeIn>
  );
}

export interface SourceChooserProps {
  error: string | null;
  onCamera: () => void;
  onLibrary: () => void;
  onDescribe: () => void;
}

/** Cámara / Fotos / Descríbela — also where a cancelled or failed picker lands. */
export function SourceChooser({ error, onCamera, onLibrary, onDescribe }: SourceChooserProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.root}>
      <Text variant="title" accessibilityRole="header">
        ¿Qué has comido?
      </Text>
      <Text variant="callout" color="textMuted">
        Hazle una foto y calculo las calorías y los macros. Luego lo revisas tú.
      </Text>
      {error ? (
        <View accessibilityRole="alert" style={[styles.error, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <View style={styles.row}>
            <Icon name="warning" size={18} color={colors.warning} />
            <Text variant="callout" style={styles.text}>
              {error}
            </Text>
          </View>
          {needsSettings(error) ? (
            <Button label="Abrir Ajustes" variant="secondary" size="sm" icon="settings" onPress={() => void Linking.openSettings()} />
          ) : null}
        </View>
      ) : null}
      <View style={styles.options}>
        <SourceOption index={0} icon="camera" title="Cámara" subtitle="Haz una foto del plato" onPress={onCamera} />
        <SourceOption index={1} icon="photo" title="Fotos" subtitle="Elige una foto de tu carrete" onPress={onLibrary} />
        <SourceOption index={2} icon="edit" title="Descríbela" subtitle="Dímelo o escríbelo, sin foto" onPress={onDescribe} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  options: { gap: space.sm, marginTop: space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 64,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  error: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
