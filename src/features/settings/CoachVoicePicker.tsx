import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useRepository } from '@/data/context';
import { COACH_VOICE_OPTIONS, setCoachVoice, useCoachVoice, type CoachVoice } from '@/integrations/speech/coachVoice';
import { useSpeaker } from '@/integrations/speech/useSpeaker';
import { Card, Divider, Icon, Text, haptics, iconSize, radius, space, useTheme } from '@/ui';

/** What each voice says when you pick it (cached after the first time, so it costs nothing). */
export const VOICE_SAMPLE =
  'Hola, soy tu coach. Hoy toca rodaje suave de cuarenta y cinco minutos: sin mirar el reloj, disfrutando. Mañana apretamos.';

const TILE = 32;

/**
 * Tú → Tu coach → Voz: pick the voice of the briefing and the voice coach. Tapping a voice selects
 * it and plays a short sample; tapping it again while it talks stops it.
 */
export function CoachVoicePicker() {
  const { colors } = useTheme();
  const repository = useRepository();
  const selected = useCoachVoice();
  const speaker = useSpeaker();
  const naturalAvailable = Boolean(repository.synthesizeSpeech);

  const choose = (value: CoachVoice) => {
    haptics.tap();
    if (value === selected && speaker.speaking) {
      speaker.stop();
      return;
    }
    void setCoachVoice(value).then(() => speaker.speak(VOICE_SAMPLE));
  };

  return (
    <View style={styles.wrap}>
      <Text variant="body" color="textMuted">
        Es la voz del informe de la mañana y del coach cuando le hablas. Toca una para escucharla.
      </Text>
      <Card padding={0} style={styles.card}>
        <View accessibilityRole="radiogroup" accessibilityLabel="Voz del coach">
          {COACH_VOICE_OPTIONS.map((option, index) => {
            const checked = option.value === selected;
            const talking = checked && speaker.speaking;
            return (
              <Fragment key={option.value}>
                {index > 0 ? <Divider inset={TILE + space.md + space.md} /> : null}
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked }}
                  accessibilityLabel={`${option.name}. ${option.description}`}
                  accessibilityHint={talking ? 'Toca para parar la muestra' : 'Selecciona esta voz y escucha una muestra'}
                  onPress={() => choose(option.value)}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}>
                  <View style={[styles.tile, { backgroundColor: checked ? colors.accentSoft : colors.surfaceAlt }]}>
                    <Icon
                      name={option.value === 'device' ? 'phone' : talking ? 'waveform' : 'speaker'}
                      size={iconSize.sm}
                      color={checked ? colors.onAccentSoft : colors.textMuted}
                    />
                  </View>
                  <View style={styles.text}>
                    <Text variant="bodyStrong">{option.name}</Text>
                    <Text variant="caption" color="textMuted">
                      {talking ? 'Escuchando…' : option.description}
                    </Text>
                  </View>
                  {checked ? <Icon name="check" size={iconSize.md} color={colors.accentInk} /> : null}
                </Pressable>
              </Fragment>
            );
          })}
        </View>
      </Card>
      <Text variant="caption" color="textMuted" style={styles.footer}>
        {naturalAvailable
          ? 'Las voces naturales se generan gratis con la IA del coach y se guardan en el iPhone, así que repetir el informe no gasta nada. Sin conexión, o si un día se agota la cuota gratuita, habla con una voz más sencilla o con la del iPhone.'
          : 'Sin la cuenta conectada (modo demo) o con la IA desactivada, el coach habla con la voz del iPhone.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  card: { paddingVertical: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
  },
  tile: { width: TILE, height: TILE, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  footer: { paddingHorizontal: space.xs },
});
