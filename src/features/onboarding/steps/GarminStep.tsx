import { useEffect, useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { todayISO } from '@/domain/dates';
import { ErrorNotice, Loading, space } from '@/ui';

import { Appear } from '../Appear';
import { GarminGuide, GarminImported, GarminPasteControl, GarminPastePanel } from '../garmin/GarminParts';
import { useGarminConnect, type GarminConnect } from '../garmin/useGarminConnect';
import { confirmAction } from '../../settings/confirm';
import { DEMO_GARMIN_KEY, GARMIN_SKIP_AFTER_MS } from '../connectModel';
import { SkipLink, WorkingState } from '../GuideParts';
import { StepLayout, type StepAction, type StepNav } from '../StepLayout';

export interface GarminStepProps {
  nav: StepNav;
  isDemo: boolean;
  /** Skipped before (the athlete came back): the way out is offered right away. */
  skipped: boolean;
  /** "Seguir sin Garmin": the flow records it and moves on. */
  onSkip: () => void;
}

/**
 * Step 3 (required): open Garmin Connect in the in-app browser, create a
 * 1-year key, copy it, come back and paste → connect + first sync → what we
 * imported. "Continuar" only exists once Garmin is connected; a discreet
 * "Seguir sin Garmin" appears after a failed attempt or 45 s (no watch,
 * Garmin down, App Review…).
 */
export function GarminStep({ nav, isDemo, skipped, onSkip }: GarminStepProps) {
  const today = todayISO();
  const garmin = useGarminConnect({ isDemo, today });
  const busy = garmin.phase === 'connecting';
  const waitedLong = useElapsed(GARMIN_SKIP_AFTER_MS);
  const canSkip = !busy && garmin.phase !== 'connected' && (skipped || garmin.failed || waitedLong);

  const skip = async () => {
    const ok = await confirmAction({
      title: '¿Seguir sin Garmin?',
      message:
        'Sin Garmin no sé cómo duermes ni lo que entrenas, así que tu plan y tu informe serán más genéricos. Puedes conectarlo cuando quieras en Tú › Conexiones.',
      confirmLabel: 'Seguir sin Garmin',
      cancelLabel: 'Volver',
    });
    if (ok) onSkip();
  };

  return (
    <StepLayout nav={nav} busy={busy} primary={primaryFor(garmin, nav)} secondary={secondaryFor(garmin, isDemo)}>
      <Appear index={1}>
        <GarminBody garmin={garmin} today={today} />
      </Appear>
      {canSkip ? <SkipLink label="Seguir sin Garmin" hint="Podrás conectarlo después en Tú" onPress={() => void skip()} /> : null}
    </StepLayout>
  );
}

/** True once `ms` have passed since mount. */
function useElapsed(ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return elapsed;
}

function GarminBody({ garmin, today }: { garmin: GarminConnect; today: string }) {
  if (garmin.checking) return <Loading label="Comprobando tu Garmin" />;
  switch (garmin.phase) {
    case 'connecting':
      return <WorkingState title="Conectando con Garmin e importando tus datos…" message="Traemos tus últimas 4 semanas. Puede tardar hasta un minuto." />;
    case 'connected':
      return <GarminImported today={today} />;
    case 'paste':
      return <GarminPastePanel garmin={garmin} />;
    default:
      return (
        <View style={styles.wrap}>
          {garmin.needsRenewal ? (
            <ErrorNotice message="Tu clave de Garmin ha caducado. Crea una nueva siguiendo estos pasos." />
          ) : null}
          <GarminGuide />
          {garmin.error ? <ErrorNotice message={garmin.error} /> : null}
        </View>
      );
  }
}

function primaryFor(garmin: GarminConnect, nav: StepNav): StepAction | ReactElement {
  switch (garmin.phase) {
    case 'connected':
      return { label: 'Continuar', iconRight: 'arrowRight', onPress: nav.next };
    case 'connecting':
      return { label: 'Conectando…', onPress: () => undefined, loading: true };
    case 'paste':
      return <GarminPasteControl garmin={garmin} />;
    default:
      return { label: 'Abrir Garmin Connect', icon: 'externalLink', onPress: () => void garmin.openGarmin(), disabled: garmin.checking };
  }
}

function secondaryFor(garmin: GarminConnect, isDemo: boolean): StepAction | null {
  if (garmin.phase === 'intro' && !garmin.checking) {
    return { label: 'Ya tengo la clave copiada', onPress: garmin.showPaste };
  }
  if (garmin.phase === 'paste') {
    if (isDemo) return { label: 'Usar una clave de prueba (demo)', onPress: () => void garmin.submit(DEMO_GARMIN_KEY) };
    return { label: 'Abrir Garmin otra vez', icon: 'externalLink', onPress: () => void garmin.openGarmin() };
  }
  return null;
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
});
