import { router } from 'expo-router';
import { useRef, useState } from 'react';

import { addDays, formatDayMedium } from '@/domain/dates';
import type { SeasonWeek } from '@/domain/season';
import { useTabBottomPadding } from '@/features/accessory/useTabBottomPadding';
import { PlanViewSwitch } from '@/features/week/PlanViewSwitch';
import { errorMessage } from '@/lib/logger';
import { Button, Disclosure, EmptyState, ErrorNotice, Loading, Screen } from '@/ui';

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
        title="Completa tu perfil"
        message="Indica tus deportes y tu nivel para preparar las semanas hasta tu carrera."
        action={<Button label="Tu perfil" variant="secondary" onPress={() => router.push('/settings/profile')} />}
      />
    );
  }
  if (!season) return error;
  const current = season.weeks.find((week) => week.isCurrent);
  const future = season.weeks.filter((week) => !week.isCurrent);
  const renderWeek = (week: SeasonWeek) => (
    <SeasonWeekRow
      key={week.weekStart}
      week={week}
      sessions={data.sessions[week.weekStart] ?? 0}
      keySessions={data.keySessions[week.weekStart] ?? NO_KEY_SESSIONS}
      onOpen={openWeek}
      onAdjust={onAdjust}
    />
  );
  return (
    <>
      {error}
      <SeasonHero season={season} today={data.today} />
      {current ? renderWeek(current) : null}
      {groupSeasonBlocks(future).map((block) => (
        <Disclosure
          key={block.weeks[0]!.weekStart}
          title={block.title}
          summary={`${formatDayMedium(block.weeks[0]!.weekStart)} – ${formatDayMedium(addDays(block.weeks[block.weeks.length - 1]!.weekStart, 6))}`}>
          {block.weeks.map(renderWeek)}
        </Disclosure>
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

