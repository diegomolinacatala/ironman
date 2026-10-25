import { useEffect, useState } from 'react';

import { errorMessage } from '@/lib/logger';
import { haptics } from '@/ui';

import { showNotice } from './confirm';
import { copyText, shareInvite } from './share';

const COPIED_FEEDBACK_MS = 2000;

export interface InviteActions {
  copied: boolean;
  sharing: boolean;
  copyUsername: () => Promise<void>;
  share: () => Promise<void>;
}

/** Copy "@username" / open the share sheet, with short-lived "Copiado" feedback. */
export function useInviteActions(username: string | null | undefined): InviteActions {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const handle = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(handle);
  }, [copied]);

  const copyUsername = async () => {
    if (!username) return;
    const ok = await copyText(`@${username}`);
    if (ok) {
      haptics.success();
      setCopied(true);
    } else {
      showNotice('No se ha podido copiar', 'Inténtalo de nuevo.');
    }
  };

  const share = async () => {
    if (!username) return;
    setSharing(true);
    try {
      const outcome = await shareInvite(username);
      if (outcome === 'copied') {
        setCopied(true);
        showNotice('Invitación copiada', 'Pégala en un mensaje para tu amigo.');
      }
    } catch (error) {
      showNotice('No se ha podido compartir', errorMessage(error));
    } finally {
      setSharing(false);
    }
  };

  return { copied, sharing, copyUsername, share };
}
