import type { Profile, ProfilePatch } from '@/domain/types';

import { RepositoryError, type Repository } from '../repository';
import { USERNAME_HELP, USERNAME_RE } from '../demo/validation';
import { run, runOne, type SupabaseCtx } from './base';
import { profilePatchToRow, rowToProfile } from './mappers';
import type { ProfileRow } from './rows';

type ProfileMethods = Pick<Repository, 'getMyProfile' | 'upsertMyProfile' | 'isUsernameAvailable'>;

export function profileApi(ctx: SupabaseCtx): ProfileMethods {
  const { client } = ctx;

  async function getMyProfile(): Promise<Profile | null> {
    const me = await ctx.userId();
    const row = await run<ProfileRow | null>(
      'getMyProfile',
      client.from('profiles').select('*').eq('id', me).maybeSingle(),
    );
    return row ? rowToProfile(row) : null;
  }

  async function upsertMyProfile(patch: ProfilePatch): Promise<Profile> {
    const me = await ctx.userId();
    const values = profilePatchToRow(patch);
    if (typeof values.username === 'string' && !USERNAME_RE.test(values.username)) {
      throw new RepositoryError('validation', USERNAME_HELP);
    }
    if (Object.keys(values).length === 0) {
      const current = await getMyProfile();
      if (!current) throw new RepositoryError('not_found', 'No encontramos tu perfil. Cierra sesión y vuelve a entrar.');
      return current;
    }
    const row = await runOne<ProfileRow>(
      'upsertMyProfile',
      client.from('profiles').update(values).eq('id', me).select('*').maybeSingle(),
      'No encontramos tu perfil. Cierra sesión y vuelve a entrar.',
    );
    return rowToProfile(row);
  }

  async function isUsernameAvailable(username: string): Promise<boolean> {
    const wanted = username.trim().replace(/^@/, '').toLowerCase();
    if (!USERNAME_RE.test(wanted)) return false;
    // Other users' profiles are not readable (RLS): `is_username_available` (db migration 0230).
    const available = await run<unknown>('isUsernameAvailable', client.rpc('is_username_available', { p_username: wanted }));
    return available === true;
  }

  return { getMyProfile, upsertMyProfile, isUsernameAvailable };
}
