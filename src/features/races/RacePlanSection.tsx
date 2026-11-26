import { Fragment, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { racePlanHint } from '@/domain/racePlan';
import { Disclosure, Divider, Tag, space, useTheme } from '@/ui';

import { RaceFuelBlock, RacePlanHint, RaceTransitions } from './RacePlanBlocks';
import { RacePlanLeg } from './RacePlanLeg';
import type { RacePlanView } from './racePlanModel';

export interface RacePlanSectionProps {
  view: RacePlanView;
  /** Shown first inside the fold (the finish-time prediction). */
  header?: ReactNode;
}

/**
 * «Plan de carrera» of the next A race: folded to one line (bike · run · fuel);
 * from three weeks before it is highlighted and opens by default.
 */
export function RacePlanSection({ view, header }: RacePlanSectionProps) {
  const { colors } = useTheme();
  const { plan, highlighted, badge } = view;
  const hint = racePlanHint(plan);
  const blocks: ReactNode[] = [
    header ?? null,
    plan.swim ? <RacePlanLeg sport="swim" title="Natación" leg={plan.swim} /> : null,
    plan.bike ? <RacePlanLeg sport="bike" title="Bici" leg={plan.bike} /> : null,
    <RacePlanLeg sport="run" title={plan.triathlon ? 'Carrera a pie' : 'Carrera'} leg={plan.run} note={plan.run.hrNote} />,
    <RaceFuelBlock fuel={plan.fuel} triathlon={plan.triathlon} />,
    plan.transitions ? <RaceTransitions t1={plan.transitions.t1} t2={plan.transitions.t2} /> : null,
  ].filter((block) => block !== null);

  return (
    <Disclosure
      testID="race-plan"
      title="Plan de carrera"
      summary={plan.summary}
      icon="target"
      iconTint={highlighted ? colors.accentSoft : undefined}
      iconColor={highlighted ? colors.onAccentSoft : undefined}
      accessory={badge ? <Tag label={badge} color={colors.accentInk} icon="flag" /> : null}
      defaultOpen={highlighted}>
      {hint ? <RacePlanHint text={hint} /> : null}
      <View style={styles.blocks}>
        {blocks.map((block, index) => (
          <Fragment key={index}>
            {index > 0 ? <Divider /> : null}
            {block}
          </Fragment>
        ))}
      </View>
    </Disclosure>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: space.lg },
});
