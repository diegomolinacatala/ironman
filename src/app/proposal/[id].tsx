import { Stack, useLocalSearchParams } from 'expo-router';

import { useProposal } from '@/data/queries';
import { HeaderCloseButton } from '@/features/coach/HeaderCloseButton';
import { ProposalReview, closeModal } from '@/features/coach/ProposalReview';
import { errorMessage } from '@/lib/logger';
import { Button, EmptyState, ErrorNotice, Loading, Screen } from '@/ui';

/** Modal header with a "Cerrar" button: reviewing later must not require a swipe or a discard. */
function Header() {
  return <Stack.Screen options={{ headerLeft: () => <HeaderCloseButton onPress={closeModal} /> }} />;
}

export default function ProposalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const proposal = useProposal(id);
  return (
    <>
      <Header />
      <ProposalBody proposal={proposal} />
    </>
  );
}

function ProposalBody({ proposal }: { proposal: ReturnType<typeof useProposal> }) {
  if (proposal.isLoading) {
    return (
      <Screen inSheet>
        <Loading label="Cargando la propuesta…" />
      </Screen>
    );
  }
  if (proposal.error) {
    return (
      <Screen inSheet>
        <ErrorNotice
          message={errorMessage(proposal.error, 'No se ha podido cargar la propuesta.')}
          onRetry={() => void proposal.refetch()}
        />
      </Screen>
    );
  }
  if (!proposal.data) {
    return (
      <Screen inSheet>
        <EmptyState
          icon="info"
          title="Propuesta no encontrada"
          message="Puede que se haya borrado o que pertenezca a otra cuenta."
          action={<Button label="Cerrar" variant="secondary" onPress={closeModal} />}
        />
      </Screen>
    );
  }
  // Keyed by id so selection resets for another proposal but survives the
  // status refresh that follows "Aplicar" (the outcome banner must stay).
  return <ProposalReview key={proposal.data.id} proposal={proposal.data} />;
}
