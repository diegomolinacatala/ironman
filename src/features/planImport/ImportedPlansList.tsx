import { Fragment } from 'react';

import { useDeletePlanImport, usePlanImports } from '@/data/queries';
import { formatDayMedium } from '@/domain/dates';
import { planImportSourceLabel } from '@/domain/planImport';
import type { PlanImport } from '@/domain/planImport';
import { confirmAsync, notify } from '@/features/workouts/confirm';
import { errorMessage } from '@/lib/logger';
import { Card, Disclosure, Divider, IconButton, ListRow, haptics } from '@/ui';

function subtitle(p: PlanImport): string {
  return `${planImportSourceLabel(p.source)} · ${p.sessionCount} sesiones · ${formatDayMedium(p.startDate)} – ${formatDayMedium(p.endDate)}`;
}

/** Tú › Importar un plan: the saved imports, each removable (its pending sessions go with it). */
export function ImportedPlansList() {
  const imports = usePlanImports();
  const remove = useDeletePlanImport();
  const list = imports.data ?? [];
  if (list.length === 0) return null;

  const onDelete = async (p: PlanImport) => {
    const ok = await confirmAsync({
      title: `¿Quitar «${p.title}»?`,
      message: 'Borro sus sesiones pendientes. Las que ya hiciste se quedan en tu historial. Después puedes planificar esas semanas con la app.',
      confirmLabel: 'Quitar plan',
      destructive: true,
    });
    if (!ok) return;
    try {
      const { removed } = await remove.mutateAsync(p.id);
      haptics.success();
      notify('Plan quitado', `${removed} ${removed === 1 ? 'sesión pendiente borrada' : 'sesiones pendientes borradas'}.`);
    } catch (error) {
      notify('No se pudo quitar el plan', errorMessage(error));
    }
  };

  return (
    <Disclosure
      variant="plain"
      title="Planes importados"
      summary={list.length === 1 ? '1 plan: quítalo para volver a planificar con la app' : `${list.length} planes`}
      icon="clipboard"
      storageKey="planImport.saved"
      defaultOpen>
      <Card padding="xs">
        {list.map((p, index) => (
          <Fragment key={p.id}>
            {index > 0 ? <Divider inset={48} /> : null}
            <ListRow
              icon="clipboard"
              title={p.title}
              subtitle={subtitle(p)}
              right={<IconButton icon="trash" accessibilityLabel={`Quitar ${p.title}`} disabled={remove.isPending} onPress={() => void onDelete(p)} />}
            />
          </Fragment>
        ))}
      </Card>
    </Disclosure>
  );
}
