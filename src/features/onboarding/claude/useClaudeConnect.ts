import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Share } from 'react-native';

import { useCreateToken, useRevokeToken, useTokens } from '@/data/queries';
import type { CreatedToken, ISODateTime, PersonalToken } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import { useCopy } from '../../settings/useCopy';
import {
  CLAUDE_POLL_MS,
  CLAUDE_SKIP_AFTER_MS,
  CLAUDE_TOKEN_LABEL,
  claudeLinkState,
  latestUsedClaudeToken,
  tokensToRevokeBeforeCreate,
  type ClaudeLink,
} from '../connectModel';
import { usePolling } from '../usePolling';

export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/settings/connectors';
const COPY_KEY = 'claude-url';

export interface ClaudeConnect {
  link: ClaudeLink;
  /** Tokens still loading: do not create or claim anything yet. */
  checking: boolean;
  /** Link created in this session: its secret URL can be shown and copied. */
  created: CreatedToken | null;
  /** Earlier unused link we keep waiting on; its secret URL can never be shown again. */
  pending: PersonalToken | null;
  creating: boolean;
  error: string | null;
  copied: boolean;
  /** "Saltar por ahora" may be shown (45 s after we started waiting). */
  canSkip: boolean;
  lastUsedAt: ISODateTime | null;
  /** Revokes the never-used links, creates a new one and copies its URL. */
  create: () => Promise<void>;
  copy: () => Promise<void>;
  open: () => Promise<void>;
  share: () => Promise<void>;
}

export interface ClaudeConnectOptions {
  /** The token created in this session (lifted so it survives step changes). */
  created: CreatedToken | null;
  onCreated: (token: CreatedToken) => void;
  /** Earlier link to keep waiting on when there is no fresh one in memory (never mint one per visit). */
  reuse: (tokens: readonly PersonalToken[]) => PersonalToken | null;
  /** Poll only while the screen is visible. */
  active: boolean;
}

/**
 * "Conecta tu Claude": personal `mcp` link, copied, claude.ai connectors in the
 * in-app browser, and a 3 s poll of the tokens until THAT link is used.
 * Demo mode needs nothing special: the demo repository marks the link used.
 */
export function useClaudeConnect({ created, onCreated, reuse, active }: ClaudeConnectOptions): ClaudeConnect {
  const tokens = useTokens();
  const createToken = useCreateToken();
  const revokeToken = useRevokeToken();
  const clipboard = useCopy();
  const [error, setError] = useState<string | null>(null);
  const [canSkip, setCanSkip] = useState(false);
  const list = tokens.data ?? [];
  const pending = created ? null : reuse(list);
  const waitingId = created?.token.id ?? pending?.id ?? null;
  const link = claudeLinkState(list, waitingId);
  const watched = waitingId ? list.find((t) => t.id === waitingId) : undefined;
  const lastUsedAt = watched?.lastUsedAt ?? latestUsedClaudeToken(list)?.lastUsedAt ?? null;

  usePolling(() => void tokens.refetch(), CLAUDE_POLL_MS, active && link === 'waiting');
  useSkipAfterWaiting(link, setCanSkip);

  const create = useCallback(async () => {
    setError(null);
    try {
      for (const id of tokensToRevokeBeforeCreate(tokens.data ?? [])) {
        await revokeToken.mutateAsync(id).catch((err: unknown) => logger.warn('claude: revoke unused link failed', err));
      }
      const token = await createToken.mutateAsync({ scope: 'mcp', label: CLAUDE_TOKEN_LABEL });
      onCreated(token);
      await clipboard.copy(token.url, COPY_KEY);
    } catch (err) {
      logger.warn('claude: create token failed', err);
      haptics.warning();
      setError(errorMessage(err, 'No hemos podido crear tu enlace. Inténtalo de nuevo.'));
    }
  }, [tokens.data, revokeToken, createToken, onCreated, clipboard]);

  const open = useCallback(async () => {
    if (created) await clipboard.copy(created.url, COPY_KEY);
    try {
      await WebBrowser.openBrowserAsync(CLAUDE_CONNECTORS_URL, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
    } catch (err) {
      logger.warn('claude: open connectors failed', err);
    }
    void tokens.refetch();
  }, [created, clipboard, tokens]);

  const share = useCallback(async () => {
    if (!created) return;
    try {
      await Share.share({ message: created.url });
    } catch (err) {
      logger.warn('claude: share url failed', err);
    }
  }, [created]);

  return {
    link,
    checking: tokens.isLoading,
    created,
    pending,
    creating: createToken.isPending,
    error: error ?? clipboard.error,
    copied: clipboard.copiedKey === COPY_KEY,
    canSkip,
    lastUsedAt,
    create,
    copy: async () => {
      if (created) await clipboard.copy(created.url, COPY_KEY);
    },
    open,
    share,
  };
}

/** 45 s of waiting → the discreet skip; a haptic when the wait ends in a connection. */
function useSkipAfterWaiting(link: ClaudeLink, setCanSkip: (value: boolean) => void): void {
  useEffect(() => {
    if (link !== 'waiting') return undefined;
    const timer = setTimeout(() => setCanSkip(true), CLAUDE_SKIP_AFTER_MS);
    return () => clearTimeout(timer);
  }, [link, setCanSkip]);

  const wasWaiting = useRef(false);
  useEffect(() => {
    if (link === 'waiting') wasWaiting.current = true;
    if (link === 'connected' && wasWaiting.current) haptics.success();
  }, [link]);
}

/** Onboarding: creates (and copies) the link once per visit, only when there is none to wait on. */
export function useAutoCreateLink(claude: ClaudeConnect, enabled: boolean): void {
  const tried = useRef(false);
  const shouldCreate =
    enabled && !claude.checking && claude.link === 'none' && !claude.created && !claude.pending && !claude.creating;
  const { create } = claude;
  useEffect(() => {
    if (!shouldCreate || tried.current) return;
    tried.current = true;
    void create();
  }, [shouldCreate, create]);
}
