/**
 * Session context for the public application.
 *
 * The session is a server-side row referenced by an opaque HttpOnly cookie; this
 * context only mirrors what the server tells it. Signing in exchanges the card
 * number + account password (+ one-time code when enabled) for that cookie plus a
 * CSRF token, which is kept in memory — never in localStorage, never in a URL.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProfileRole } from '@parsbank/types';
import { ApiError, api, setCsrfToken } from './api.ts';

export interface SessionInfo {
  profileId: string;
  role: ProfileRole;
  fullNameFa: string;
  fullNameEn: string;
  publicRef: string;
  audience: 'USER' | 'ADMIN';
  mfaSatisfied: boolean;
  mustRotatePassword: boolean;
}

interface SessionContextValue {
  status: 'loading' | 'anonymous' | 'authenticated';
  session: SessionInfo | null;
  error: string | null;
  login: (input: { cardNumber: string; password: string; totpCode?: string }) => Promise<SessionInfo>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionContextValue['status']>('loading');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await api.get<SessionInfo>('/auth/session');
      setSession(result);
      setStatus('authenticated');
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
        setSession(null);
        setStatus('anonymous');
        setCsrfToken(null);
        return;
      }
      setSession(null);
      setStatus('anonymous');
      setError(caught instanceof Error ? caught.message : 'خطا در بررسی نشست.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (input: { cardNumber: string; password: string; totpCode?: string }) => {
      const result = await api.post<SessionInfo & { csrfToken: string }>(
        '/auth/login',
        { cardNumber: input.cardNumber, password: input.password, totpCode: input.totpCode ?? undefined },
        { anonymous: true },
      );
      setCsrfToken(result.csrfToken);
      const info: SessionInfo = {
        profileId: result.profileId,
        role: result.role,
        fullNameFa: result.fullNameFa,
        fullNameEn: result.fullNameEn,
        publicRef: result.publicRef,
        audience: result.audience,
        mfaSatisfied: result.mfaSatisfied,
        mustRotatePassword: result.mustRotatePassword,
      };
      setSession(info);
      setStatus('authenticated');
      setError(null);
      return info;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // A failed logout still clears local state: the cookie is dropped by expiry
      // and the server row is revoked on the next successful call.
    }
    setCsrfToken(null);
    setSession(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ status, session, error, login, logout, refresh }),
    [status, session, error, login, logout, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
