import { complianceLabel } from '@/domain/labels';
import type { Compliance } from '@/domain/load';
import type { IconName } from '@/ui';
import { complianceColor } from '@/ui';

export interface ComplianceMeta {
  /** Spanish label (accessibility + legends). */
  label: string;
  /** Glyph shown inside the dot: an icon or a short text symbol. */
  glyph: { icon: IconName } | { text: string };
  /** Solid colour; null = neutral outline (pending). */
  color: string | null;
}

const META: Record<Compliance, Omit<ComplianceMeta, 'label'>> = {
  done: { glyph: { icon: 'check' }, color: complianceColor.done },
  partial: { glyph: { text: '~' }, color: complianceColor.partial },
  off: { glyph: { text: '!' }, color: complianceColor.off },
  missed: { glyph: { icon: 'close' }, color: complianceColor.missed },
  unplanned: { glyph: { icon: 'add' }, color: complianceColor.unplanned },
  adjusted: { glyph: { icon: 'undo' }, color: complianceColor.adjusted },
  pending: { glyph: { icon: 'clock' }, color: null },
};

export function complianceMeta(state: Compliance): ComplianceMeta {
  return { ...META[state], label: complianceLabel(state) };
}

/** Compliance band for a whole-week ratio (0..1), used to colour the week bar. */
export function weekComplianceState(pct: number | null): Compliance {
  if (pct == null) return 'pending';
  if (pct >= 0.8 && pct <= 1.2) return 'done';
  if (pct >= 0.5 && pct <= 1.5) return 'partial';
  return 'off';
}
