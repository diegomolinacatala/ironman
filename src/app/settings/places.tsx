import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GEAR_KEYS, GEAR_LABELS } from '@/domain/places';
import type { PlaceGear, Profile } from '@/domain/types';
import { placesForm, placesFormError, placesPatch, toggleGear, type PlacesForm } from '@/features/places/placesModel';
import { KeyboardAvoider } from '@/features/settings/KeyboardAvoider';
import { ProfileGate } from '@/features/settings/ProfileGate';
import { SwitchRow } from '@/features/settings/SwitchRow';
import { useProfileSave } from '@/features/settings/useProfileSave';
import { Button, Chip, ErrorNotice, Screen, SectionHeader, Text, TextField, space } from '@/ui';

export default function PlacesScreen() {
  return <ProfileGate>{(profile) => <PlacesEditor profile={profile} />}</ProfileGate>;
}

const GEAR_ICONS = { roadBike: 'bike', trainer: 'bike', pool: 'swim', gym: 'strength' } as const;

function GearChips({ gear, onToggle, place }: { gear: PlaceGear; onToggle: (key: keyof PlaceGear) => void; place: string }) {
  return (
    <View style={styles.chips} accessibilityLabel={`Material en ${place}`}>
      {GEAR_KEYS.map((key) => (
        <Chip key={key} label={GEAR_LABELS[key]} icon={GEAR_ICONS[key]} selected={gear[key]} onPress={() => onToggle(key)} />
      ))}
    </View>
  );
}

/**
 * Tú › Mis sitios: the main city and the city of the weekends away, with what the athlete has
 * in each (bici de carretera, rodillo, piscina, gimnasio), and the Sunday/Wednesday questions
 * (off by default). The planner honours the gear of the place of each day.
 */
function PlacesEditor({ profile }: { profile: Profile }) {
  const [form, setForm] = useState<PlacesForm>(() => placesForm(profile));
  const [problem, setProblem] = useState<string | null>(null);
  const { save, saving, error } = useProfileSave();
  const set = (patch: Partial<PlacesForm>) => {
    setProblem(null);
    setForm((f) => ({ ...f, ...patch }));
  };
  const onSave = () => {
    const issue = placesFormError(form);
    if (issue) {
      setProblem(issue);
      return;
    }
    void save(placesPatch(form, profile.weekQuestions), { goBack: true });
  };
  const shown = problem ?? error;
  return (
    <KeyboardAvoider>
      <Screen
        inSheet
        footer={
          <View style={styles.footer}>
            {shown ? <ErrorNotice message={shown} /> : null}
            <Button label="Guardar" size="lg" icon="check" fullWidth loading={saving} onPress={onSave} />
          </View>
        }>
        <Text variant="callout" color="textMuted">
          Dónde entrenas y qué tienes en cada sitio. Si un sitio no tiene rodillo ni bici, esos días van sin bici; si solo tiene rodillo, la
          bici va en rodillo; sin piscina, sin natación.
        </Text>
        <View style={styles.section}>
          <SectionHeader title="Tu ciudad principal" />
          <TextField label="Ciudad" placeholder="Valencia" value={form.homeName} onChangeText={(homeName) => set({ homeName })} maxLength={60} />
          <GearChips gear={form.homeGear} place={form.homeName || 'tu ciudad'} onToggle={(k) => set({ homeGear: toggleGear(form.homeGear, k) })} />
        </View>
        <View style={styles.section}>
          <SectionHeader title="Tu otra ciudad" />
          <Text variant="caption" color="textMuted">
            Opcional: donde vuelves algunos fines de semana. El miércoles te preguntamos si vas.
          </Text>
          <TextField label="Ciudad (opcional)" placeholder="Castellón" value={form.awayName} onChangeText={(awayName) => set({ awayName })} maxLength={60} />
          {form.awayName.trim() ? (
            <GearChips gear={form.awayGear} place={form.awayName} onToggle={(k) => set({ awayGear: toggleGear(form.awayGear, k) })} />
          ) : null}
        </View>
        <View style={styles.section}>
          <SectionHeader title="Preguntas de la semana" />
          <SwitchRow
            icon="checkin"
            title="Domingo y miércoles"
            subtitle="El domingo, cómo ves tu semana; el miércoles, si vuelves el finde. Ajustan el plan."
            value={form.questions}
            onChange={(questions) => set({ questions })}
          />
        </View>
      </Screen>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  footer: { gap: space.sm },
  section: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
