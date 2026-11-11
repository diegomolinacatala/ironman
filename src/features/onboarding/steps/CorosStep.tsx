import type { ReactNode } from 'react';

import { openCorosApp } from '@/features/settings/corosLinks';
import { Loading } from '@/ui';

import { Appear } from '../Appear';
import { GARMIN_SKIP_AFTER_MS } from '../connectModel';
import { CorosGuideIntro, CorosImported, CorosOnlyOnIphone } from '../coros/CorosParts';
import { useCorosConnect, type CorosConnect } from '../coros/useCorosConnect';
import { SkipLink, WorkingState } from '../GuideParts';
import { StepLayout, type StepAction, type StepNav } from '../StepLayout';
import { SKIP_WATCH_HINT, SKIP_WATCH_LABEL, confirmSkipWatch, useElapsed } from '../watchSkip';

export interface CorosStepProps {
  nav: StepNav;
  isDemo: boolean;
  /** Skipped before (the athlete came back): the way out is offered right away. */
  skipped: boolean;
  /** "Seguir sin reloj": the flow records it and moves on. */
  onSkip: () => void;
  /** "Continuar" after the web demo's simulated success (recorded like a skip, so resume works). */
  onSimulatedDone: () => void;
  /** "Tu reloj" (Garmin | COROS), shown above the guide. */
  picker?: ReactNode;
  /** Overrides the step title ("Conecta tu COROS"). */
  title?: string;
}

/**
 * "Tu reloj" › COROS (required): COROS has no personal API, so the COROS app writes to Apple
 * Salud and we read it here: three steps in the COROS app, «Conectar Apple Salud» (first import
 * of 4 weeks) and what arrived, or what to check while nothing from COROS has arrived yet.
 * Done once Apple Salud is on. "Seguir sin reloj" after a failure, 45 s, or at once without
 * Apple Salud (signed in on the web).
 */
export function CorosStep({ nav, isDemo, skipped, onSkip, onSimulatedDone, picker, title }: CorosStepProps) {
  const coros = useCorosConnect({ isDemo });
  const busy = coros.phase === 'connecting';
  const waitedLong = useElapsed(GARMIN_SKIP_AFTER_MS);
  const unavailable = coros.phase === 'unavailable';
  const canSkip = !busy && !coros.done && !unavailable && (skipped || coros.failed || waitedLong);

  const skip = async () => {
    if (await confirmSkipWatch()) onSkip();
  };
  const primary = unavailable ? { label: SKIP_WATCH_LABEL, onPress: () => void skip() } : primaryFor(coros, nav, onSimulatedDone);

  return (
    <StepLayout nav={nav} busy={busy} title={title} primary={primary} secondary={secondaryFor(coros)}>
      {picker}
      <Appear index={1}>
        <CorosBody coros={coros} />
      </Appear>
      {canSkip ? <SkipLink label={SKIP_WATCH_LABEL} hint={SKIP_WATCH_HINT} onPress={() => void skip()} /> : null}
    </StepLayout>
  );
}

function CorosBody({ coros }: { coros: CorosConnect }) {
  switch (coros.phase) {
    case 'checking':
      return <Loading label="Comprobando Apple Salud" />;
    case 'unavailable':
      return <CorosOnlyOnIphone />;
    case 'connecting':
      return <WorkingState title="Leyendo Apple Salud…" message="Buscamos tus entrenos y tu sueño de COROS de las últimas 4 semanas." />;
    case 'intro':
      return <CorosGuideIntro error={coros.error} />;
    default:
      return <CorosImported coros={coros} />;
  }
}

function primaryFor(coros: CorosConnect, nav: StepNav, onSimulatedDone: () => void): StepAction {
  switch (coros.phase) {
    case 'connecting':
      return { label: 'Leyendo Apple Salud…', onPress: () => undefined, loading: true };
    case 'checking':
    case 'intro':
      return {
        label: 'Conectar Apple Salud',
        icon: 'health',
        onPress: () => void coros.connect(),
        disabled: coros.phase === 'checking',
        accessibilityHint: 'Pide permiso para leer tus entrenos, tu sueño y tu pulso de Apple Salud',
      };
    case 'simulated':
      return { label: 'Continuar', iconRight: 'arrowRight', onPress: onSimulatedDone };
    default:
      return { label: 'Continuar', iconRight: 'arrowRight', onPress: nav.next };
  }
}

function secondaryFor(coros: CorosConnect): StepAction | null {
  if (coros.phase === 'intro') return { label: 'Abrir la app COROS', icon: 'externalLink', onPress: () => void openCorosApp() };
  if (coros.phase === 'waiting') return { label: 'Comprobar otra vez', icon: 'refresh', onPress: () => void coros.check() };
  return null;
}
