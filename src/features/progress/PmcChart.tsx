import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/ui';

import { chartPalette, type ChartPalette } from './chartPalette';
import { areaPath, linePath, linearScale, niceAxis, ticks, type Scale, type XY } from './chartScale';
import { formatInt, monthShort } from './format';
import { pmcSummary, type PmcPointLike, type PmcSeries } from './pmcModel';
import { useChartWidth } from './useChartWidth';

const PAD_RIGHT = 30;
const TOP = 20;
const MAIN_BOTTOM = 170;
const STRIP_TOP = 186;
const STRIP_BOTTOM = 240;
const HEIGHT = 262;
const DASH = '5 4';

interface Geometry {
  x: (i: number) => number;
  y: Scale;
  ty: Scale;
  yMax: number;
  yTicks: number;
  tsbMax: number;
  plotRight: number;
  split: number;
  first: number;
}

function geometry(points: readonly PmcPointLike[], width: number, todayIndex: number, firstIndex: number): Geometry {
  const n = Math.max(points.length - 1, 1);
  const plotRight = width - PAD_RIGHT;
  const peak = points.reduce((m, p) => Math.max(m, p.ctl, p.atl), 0);
  const axis = niceAxis(peak * 1.05, 40);
  const split = todayIndex >= 0 ? todayIndex : points.length - 1;
  const tsbPeak = points.reduce((m, p) => Math.max(m, Math.abs(p.tsb)), 0);
  const tsbMax = Math.max(30, Math.ceil(tsbPeak / 10) * 10);
  return {
    x: (i) => (i / n) * plotRight,
    y: linearScale([0, axis.max], [MAIN_BOTTOM, TOP]),
    ty: linearScale([-tsbMax, tsbMax], [STRIP_BOTTOM, STRIP_TOP]),
    yMax: axis.max,
    yTicks: Math.round(axis.max / axis.step),
    tsbMax,
    plotRight,
    split,
    first: Math.min(Math.max(firstIndex, 0), split),
  };
}

function seriesPoints(points: readonly PmcPointLike[], g: Geometry, key: 'ctl' | 'atl'): XY[] {
  return points.map((p, i) => ({ x: g.x(i), y: g.y(p[key]) }));
}

function Grid({ g, palette }: { g: Geometry; palette: ChartPalette }) {
  return (
    <G>
      {ticks(g.yMax, g.yTicks).map((t) => (
        <G key={t}>
          <Line x1={0} x2={g.plotRight} y1={g.y(t)} y2={g.y(t)} stroke={palette.grid} strokeWidth={1} strokeDasharray={t === 0 ? undefined : '2 4'} />
          <SvgText x={g.plotRight + 6} y={g.y(t) + 4} fontSize={11} fill={palette.axis} fontFamily={palette.font}>
            {formatInt(t)}
          </SvgText>
        </G>
      ))}
      <Rect x={0} y={g.ty(-10)} width={g.plotRight} height={g.ty(-Math.min(30, g.tsbMax)) - g.ty(-10)} fill={palette.band} />
      <Line x1={0} x2={g.plotRight} y1={g.ty(0)} y2={g.ty(0)} stroke={palette.grid} strokeWidth={1} />
      <SvgText x={g.plotRight + 6} y={g.ty(0) + 4} fontSize={11} fill={palette.axis} fontFamily={palette.font}>
        0
      </SvgText>
    </G>
  );
}

function ProjectionZone({ g, points, palette }: { g: Geometry; points: readonly PmcPointLike[]; palette: ChartPalette }) {
  const x0 = g.x(g.split);
  const hasProjection = g.split < points.length - 1;
  return (
    <G>
      {hasProjection ? (
        <Rect x={x0} y={TOP - 8} width={g.plotRight - x0} height={STRIP_BOTTOM - TOP + 8} fill={palette.projection} opacity={0.7} />
      ) : null}
      <Line x1={x0} x2={x0} y1={TOP - 8} y2={STRIP_BOTTOM} stroke={palette.today} strokeWidth={1} />
      <SvgText x={x0 - 4} y={11} fontSize={11} fill={palette.today} fontFamily={palette.font} textAnchor="end" letterSpacing={1}>
        HOY
      </SvgText>
      {hasProjection ? (
        <SvgText x={x0 + 4} y={11} fontSize={11} fill={palette.axis} fontFamily={palette.font} letterSpacing={1}>
          PLAN
        </SvgText>
      ) : null}
    </G>
  );
}

function FreshnessBars({ g, points, palette }: { g: Geometry; points: readonly PmcPointLike[]; palette: ChartPalette }) {
  const barW = Math.max(1, (g.plotRight / Math.max(points.length, 1)) * 0.62);
  const zero = g.ty(0);
  return (
    <G>
      {points.map((p, i) => {
        if (i < g.first) return null;
        const top = g.ty(p.tsb);
        return (
          <Rect
            key={p.date}
            x={g.x(i) - barW / 2}
            y={Math.min(top, zero)}
            width={barW}
            height={Math.max(Math.abs(top - zero), 0.5)}
            fill={p.tsb >= 0 ? palette.freshPositive : palette.freshNegative}
            opacity={i > g.split ? 0.45 : 1}
          />
        );
      })}
    </G>
  );
}

function Lines({ g, points, palette }: { g: Geometry; points: readonly PmcPointLike[]; palette: ChartPalette }) {
  const ctl = seriesPoints(points, g, 'ctl');
  const atl = seriesPoints(points, g, 'atl');
  const past = (xs: XY[]) => xs.slice(g.first, g.split + 1);
  const future = (xs: XY[]) => xs.slice(g.split);
  const lastCtl = ctl[g.split];
  const lastAtl = atl[g.split];
  return (
    <G>
      <Path d={areaPath(past(ctl), MAIN_BOTTOM)} fill={palette.fitness} opacity={0.07} />
      <Path d={linePath(past(atl))} stroke={palette.fatigue} strokeWidth={1.75} fill="none" strokeLinejoin="round" />
      <Path d={linePath(future(atl))} stroke={palette.fatigue} strokeWidth={1.75} fill="none" strokeDasharray={DASH} />
      <Path d={linePath(past(ctl))} stroke={palette.fitness} strokeWidth={2.75} fill="none" strokeLinejoin="round" />
      <Path d={linePath(future(ctl))} stroke={palette.fitness} strokeWidth={2.25} fill="none" strokeDasharray={DASH} />
      {lastAtl ? <Circle cx={lastAtl.x} cy={lastAtl.y} r={3.5} fill={palette.fatigue} stroke={palette.background} strokeWidth={2} /> : null}
      {lastCtl ? <Circle cx={lastCtl.x} cy={lastCtl.y} r={5} fill={palette.marker} stroke={palette.fitness} strokeWidth={2} /> : null}
    </G>
  );
}

function MonthLabels({ g, points, palette }: { g: Geometry; points: readonly PmcPointLike[]; palette: ChartPalette }) {
  const marks = points.flatMap((p, i) => (p.date.endsWith('-01') ? [{ i, label: monthShort(p.date) }] : []));
  return (
    <G>
      {marks.map((m) => (
        <G key={m.i}>
          <Line x1={g.x(m.i)} x2={g.x(m.i)} y1={STRIP_BOTTOM + 2} y2={STRIP_BOTTOM + 7} stroke={palette.axis} />
          <SvgText x={g.x(m.i) + 3} y={HEIGHT - 6} fontSize={11} fill={palette.axis} fontFamily={palette.font} letterSpacing={0.8}>
            {m.label.toUpperCase()}
          </SvgText>
        </G>
      ))}
    </G>
  );
}

/** Forma física / Fatiga lines + Frescura bars, with dashed 2-week projection. */
export function PmcChart({ series }: { series: PmcSeries }) {
  const theme = useTheme();
  const palette = chartPalette(theme);
  const { width, onLayout } = useChartWidth();
  const points = series.points;
  const g = width > 0 && points.length > 1 ? geometry(points, width, series.todayIndex, series.firstIndex) : null;

  return (
    <View onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={pmcSummary(series)} style={{ height: HEIGHT }}>
      {g ? (
        <Svg width={width} height={HEIGHT}>
          <ProjectionZone g={g} points={points} palette={palette} />
          <Grid g={g} palette={palette} />
          <FreshnessBars g={g} points={points} palette={palette} />
          <Lines g={g} points={points} palette={palette} />
          <MonthLabels g={g} points={points} palette={palette} />
        </Svg>
      ) : null}
    </View>
  );
}
