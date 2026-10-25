import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue } from 'react-native';

import type { Sport } from '@/domain/types';

/**
 * Semantic icon names → SF Symbol (iOS) + Material Symbol (Android/web).
 * Add new icons here instead of using raw symbol names in screens.
 */
const ICONS = {
  swim: { ios: 'figure.pool.swim', md: 'pool' },
  bike: { ios: 'figure.outdoor.cycle', md: 'directions_bike' },
  run: { ios: 'figure.run', md: 'directions_run' },
  brick: { ios: 'arrow.triangle.2.circlepath', md: 'sync_alt' },
  strength: { ios: 'dumbbell.fill', md: 'fitness_center' },
  mobility: { ios: 'figure.flexibility', md: 'self_improvement' },
  other: { ios: 'sportscourt.fill', md: 'sports_tennis' },
  rest: { ios: 'bed.double.fill', md: 'hotel' },
  today: { ios: 'sun.max.fill', md: 'wb_sunny' },
  week: { ios: 'calendar', md: 'calendar_month' },
  together: { ios: 'person.2.fill', md: 'group' },
  progress: { ios: 'chart.xyaxis.line', md: 'monitoring' },
  profile: { ios: 'person.crop.circle', md: 'account_circle' },
  add: { ios: 'plus', md: 'add' },
  close: { ios: 'xmark', md: 'close' },
  check: { ios: 'checkmark', md: 'check' },
  checkCircle: { ios: 'checkmark.circle.fill', md: 'check_circle' },
  skip: { ios: 'forward.end.fill', md: 'skip_next' },
  undo: { ios: 'arrow.uturn.backward', md: 'undo' },
  edit: { ios: 'pencil', md: 'edit' },
  trash: { ios: 'trash', md: 'delete' },
  move: { ios: 'arrow.left.arrow.right', md: 'swap_horiz' },
  chevronRight: { ios: 'chevron.right', md: 'chevron_right' },
  chevronLeft: { ios: 'chevron.left', md: 'chevron_left' },
  chevronDown: { ios: 'chevron.down', md: 'expand_more' },
  sparkles: { ios: 'sparkles', md: 'auto_awesome' },
  coach: { ios: 'brain.head.profile', md: 'psychology' },
  bell: { ios: 'bell.fill', md: 'notifications' },
  settings: { ios: 'gearshape.fill', md: 'settings' },
  heart: { ios: 'heart.fill', md: 'favorite' },
  heartOutline: { ios: 'heart', md: 'favorite_border' },
  flag: { ios: 'flag.checkered', md: 'sports_score' },
  clock: { ios: 'clock', md: 'schedule' },
  location: { ios: 'mappin.and.ellipse', md: 'location_on' },
  bolt: { ios: 'bolt.fill', md: 'bolt' },
  bandage: { ios: 'bandage.fill', md: 'healing' },
  illness: { ios: 'thermometer.medium', md: 'thermostat' },
  briefcase: { ios: 'briefcase.fill', md: 'work' },
  stress: { ios: 'waveform.path.ecg', md: 'monitor_heart' },
  plane: { ios: 'airplane', md: 'flight' },
  party: { ios: 'party.popper.fill', md: 'celebration' },
  book: { ios: 'book.fill', md: 'menu_book' },
  football: { ios: 'figure.soccer', md: 'sports_soccer' },
  padel: { ios: 'figure.tennis', md: 'sports_tennis' },
  food: { ios: 'fork.knife', md: 'restaurant' },
  moon: { ios: 'moon.zzz.fill', md: 'bedtime' },
  link: { ios: 'link', md: 'link' },
  copy: { ios: 'doc.on.doc', md: 'content_copy' },
  share: { ios: 'square.and.arrow.up', md: 'share' },
  info: { ios: 'info.circle', md: 'info' },
  warning: { ios: 'exclamationmark.triangle.fill', md: 'warning' },
  search: { ios: 'magnifyingglass', md: 'search' },
  send: { ios: 'paperplane.fill', md: 'send' },
  calendarBadge: { ios: 'calendar.badge.clock', md: 'event_available' },
  watch: { ios: 'applewatch', md: 'watch' },
  health: { ios: 'heart.text.square.fill', md: 'health_and_safety' },
  key: { ios: 'key.fill', md: 'key' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', md: 'logout' },
  refresh: { ios: 'arrow.clockwise', md: 'refresh' },
  trophy: { ios: 'trophy.fill', md: 'emoji_events' },
  fire: { ios: 'flame.fill', md: 'local_fire_department' },
  drop: { ios: 'drop.fill', md: 'water_drop' },
  battery: { ios: 'battery.75percent', md: 'battery_5_bar' },
  eye: { ios: 'eye', md: 'visibility' },
  lock: { ios: 'lock.fill', md: 'lock' },
  mail: { ios: 'envelope.fill', md: 'mail' },
  apple: { ios: 'apple.logo', md: 'phone_iphone' },
  more: { ios: 'ellipsis.circle', md: 'more_horiz' },
} as const;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  size?: number;
  color: ColorValue;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  style?: SymbolViewProps['style'];
}

export function Icon({ name, size = 20, color, weight = 'semibold', style }: IconProps) {
  const icon = ICONS[name];
  return (
    <SymbolView
      name={{
        ios: icon.ios as never,
        android: icon.md as never,
        web: icon.md as never,
      }}
      size={size}
      tintColor={color}
      weight={weight}
      style={[{ width: size, height: size }, style]}
    />
  );
}

export function sportIcon(sport: Sport): IconName {
  return sport;
}
