import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet } from 'react-native';

import type { SeasonWeek } from '@/domain/season';
import { useTabBottomPadding } from '@/features/accessory/useTabBottomPadding';
import { Appear } from '@/features/onboarding/Appear';
import { PlanViewSwitch } from '@/features/week/PlanViewSwitch';
import { errorMessage } from '@/lib/logger';
import { Button, EmptyState, ErrorNotice, Loading, Screen, SectionHeader, space } from '@/ui';

import { AdjustWeekSheet, type AdjustRequest } from './AdjustWeekSheet';
import { SeasonHero } from './SeasonHero';
import { groupSeasonBlocks } from './seasonModel';
import { SeasonWeekRow } from './SeasonWeekRow';
import { useSeasonData, type SeasonData } from './useSeasonData';

const COACH_MESSAGE = 'Explícame cómo organizamos las próximas semanas hasta la carrera';
const COACH_MESSAGE_NO_RACE = 'Explícame cómo organizamos las próximas semanas';
const NO_KEY_SESSIONS: readonly string[] = [];

/** Opens the coach with the question prefilled (nothing is sent without a tap). */
export function coachHref(hasRace: boolean): string {
  return `/coach?mode=chat&message=${encodeURIComponent(hasRace ? COACH_MESSAGE : COACH_MESSAGE_NO_RACE)}`;
}

/** Plan → General: the weeks from now to the target race at a glance, each one adjustable. */
export function SeasonView() {
  const data = useSeasonData();
  const bottomPadding = useTabBottomPadding();
  const opens = useRef(0);
  const [adjust, setAdjust] = useState<AdjustRequest | null>(null);
  const openAdjust = (week: SeasonWeek) => {
    opens.current += 1;
    setAdjust({ week, key: opens.current });
  };

  return (
    <Screen
      overline="Temporada"
      title="Plan"
      onRefresh={() => void data.refresh()}
      refreshing={data.isRefreshing}
      contentStyle={bottomPadding != null ? { paddingBottom: bottomPadding } : undefined}>
      <PlanViewSwitch value="general" />
      <SeasonBody data={data} onAdjust={openAdjust} />
      <AdjustWeekSheet request={adjust} context={data.adjustContext} onClose={() => setAdjust(null)} />
    </Screen>
  );
}

function openWeek(week: SeasonWeek): void {
  router.setParams({ view: 'week', week: week.weekStart });
}

function SeasonBody({ data, onAdjust }: { data: SeasonData; onAdjust: (week: SeasonWeek) => void }) {
  const { season } = data;
  if (data.isLoading && !season) return <Loading label="Preparando tu plan general" />;
  const error = data.error ? (
    <ErrorNotice message={errorMessage(data.error, 'No hemos podido cargar tu plan general.')} onRetry={() => void data.refresh()} />
  ) : null;
  if (data.missingProfile) {
    return (
      <EmptyState
        icon="profile"
        title="Completa tu disponibilidad"
        message="Con tus horas por semana preparamos el plan general hasta tu carrera."
        action={<Button label="Tu disponibilidad" variant="secondary" onPress={() => router.push('/settings/availability')} />}
      />
    );
  }
  if (!season) return error;
  return (
    <>
      {error}
      <Appear>
        <SeasonHero season={season} today={data.today} />
      </Appear>
      {groupSeasonBlocks(season.weeks).map((block, index) => (
        <Appear key={block.id} index={index + 1} style={styles.block}>
          <SectionHeader title={block.title} />
          {block.weeks.map((week) => (
            <SeasonWeekRow
              key={week.weekStart}
              week={week}
              sessions={data.sessions[week.weekStart] ?? 0}
              keySessions={data.keySessions[week.weekStart] ?? NO_KEY_SESSIONS}
              onOpen={openWeek}
              onAdjust={onAdjust}
            />
          ))}
        </Appear>
      ))}
      <Button
        label="Hablar del plan con tu coach"
        icon="coach"
        variant="secondary"
        onPress={() => router.push(coachHref(season.targetRace !== null))}
        accessibilityHint="Abre el coach con la pregunta escrita; tú decides si la envías"
      />
    </>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.md },
});
