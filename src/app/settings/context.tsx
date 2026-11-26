import { ContextScreen } from '@/features/context/ContextScreen';
import { ProfileGate } from '@/features/settings/ProfileGate';

/** Tú › Tu contexto: the coach's guided interview and «¿Algo más que deba saber?». */
export default function AthleteContextScreen() {
  return <ProfileGate>{(profile) => <ContextScreen profile={profile} />}</ProfileGate>;
}
