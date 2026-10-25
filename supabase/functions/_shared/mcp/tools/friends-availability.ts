import { uuidSchema, dateSchema } from '../../planning/changes.ts';
import { addDays, datesBetween, DEFAULT_TZ, startOfWeek, todayIn, zonedToUtc } from '../../dates.ts';
import { commonSlots, friendBusyIntervals, myBusyIntervals, sameSportDays } from '../../planning/slots.ts';
import { array, integer, object, optional } from '../../schema.ts';
import type { FriendSummary, FriendWeekItem } from '../../types.ts';
import { defineTool, READ_ONLY, toolOk, ToolInputError } from '../tool.ts';
import type { RegisteredTool, ToolContext } from '../tool.ts';

const input = object({
  week_start: optional(dateSchema('Cualquier día de la semana (se normaliza al lunes). Por defecto, la semana actual.')),
  friend_ids: optional(
    array(uuidSchema('friendId de get_planning_context.friends'), {
      max: 10,
      description: 'Amigos a consultar (friendId). Por defecto, todos los amigos aceptados.',
    }),
  ),
  min_minutes: optional(integer({ min: 20, max: 300, description: 'Duración mínima del hueco común en minutos (por defecto 45).' })),
});

function friendItemView(item: FriendWeekItem): Record<string, unknown> {
  return {
    kind: item.kind,
    date: item.date,
    startTime: item.startTime,
    endTime: item.endTime,
    durationMin: item.durationMin,
    sport: item.sport,
    intensity: item.intensity,
    title: item.title,
    status: item.status,
    isQuedada: item.jointSessionId !== null,
  };
}

async function friendBlock(
  ctx: ToolContext,
  friend: FriendSummary,
  range: { from: string; to: string },
  mine: { busy: ReturnType<typeof myBusyIntervals>; workouts: Parameters<typeof sameSportDays>[0]; windows: Parameters<typeof commonSlots>[0]['windows'] },
  minMinutes: number,
): Promise<Record<string, unknown>> {
  const items = await ctx.store.getFriendWeek(ctx.userId, friend.friendId, range.from, range.to);
  const slots = commonSlots({
    dates: datesBetween(range.from, range.to),
    busy: [...mine.busy, ...friendBusyIntervals(items)],
    windows: mine.windows,
    minMinutes,
  });
  const onlyBusy = items.length > 0 && items.every((i) => i.kind === 'busy');
  return {
    friendId: friend.friendId,
    name: friend.displayName,
    username: friend.username,
    sharing: onlyBusy ? 'solo ocupado (no comparte detalles)' : 'plan visible',
    items: items.map(friendItemView),
    commonSlots: slots,
    sameSportDays: sameSportDays(mine.workouts, items),
  };
}

export const getFriendsAvailabilityTool: RegisteredTool = defineTool({
  name: 'get_friends_availability',
  title: 'Disponibilidad de amigos y huecos comunes',
  description: [
    'Devuelve, para la semana indicada, el calendario de cada amigo aceptado tal y como ese amigo lo comparte',
    '(plan completo, solo resumen sin títulos, o solo franjas ocupadas; nunca datos de salud),',
    'los huecos libres comunes con el usuario (commonSlots: fecha, inicio, fin y minutos en hora local; dentro de las franjas de entrenamiento del usuario si las tiene para ese día, si no entre 06:00 y 22:00, con 15 min de margen)',
    'y los días en que ambos tienen planificado el mismo deporte (sameSportDays, con el workoutId del usuario).',
    'Úsala para proponer entrenar juntos; las quedadas se crean desde la app.',
  ].join(' '),
  input,
  annotations: { title: 'Disponibilidad de amigos y huecos comunes', ...READ_ONLY },
  handler: async (args, ctx) => {
    const profile = await ctx.store.getProfile(ctx.userId);
    const tz = profile?.timezone ?? DEFAULT_TZ;
    const from = startOfWeek(args.week_start ?? todayIn(tz, ctx.now()));
    const to = addDays(from, 6);
    const friends = await ctx.store.listFriends(ctx.userId);
    const selected = args.friend_ids ? friends.filter((f) => args.friend_ids?.includes(f.friendId)) : friends;
    if (args.friend_ids && selected.length === 0) {
      throw new ToolInputError(
        `Ninguno de los friend_ids es un amigo aceptado. Amigos disponibles: ${friends.map((f) => `${f.displayName} (${f.friendId})`).join(', ') || 'ninguno'}.`,
      );
    }
    const [busy, workouts] = await Promise.all([
      ctx.store.listBusyBlocks(ctx.userId, zonedToUtc(from, '00:00', tz), zonedToUtc(addDays(to, 1), '00:00', tz)),
      ctx.store.listWorkouts(ctx.userId, from, to),
    ]);
    const mine = { busy: myBusyIntervals(busy, workouts, tz), workouts, windows: profile?.availability.windows ?? [] };
    const blocks = await Promise.all(selected.map((f) => friendBlock(ctx, f, { from, to }, mine, args.min_minutes ?? 45)));
    return toolOk({
      weekStart: from,
      weekEnd: to,
      timezone: tz,
      friends: blocks,
      note: friends.length === 0 ? 'El usuario aún no tiene amigos aceptados en Rebufo.' : undefined,
    });
  },
});
