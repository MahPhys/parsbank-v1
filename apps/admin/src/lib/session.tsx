/**
 * ADMIN SESSION — who is operating the console, and what they may touch.
 *
 * The role comes from the server (`/auth/admin/session`) and is used here for one
 * purpose only: deciding which sections to *show*. Every action is re-authorised
 * server-side; hiding a button is a courtesy, never a control.
 *
 * The console deliberately refuses a member session: the ADMIN audience cookie and
 * the USER audience cookie are different cookies, and `POST /auth/admin/login` is
 * the only door into this application.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProfileRole } from '@parsbank/types';
import { ADMIN_SECTIONS, allowedSections, canAccessSection, type AdminSection, type Permission, can } from '@parsbank/domain';
import { adminApi, ApiError, describeError, setCsrfToken } from './api.ts';

export interface AdminSession {
  profileId: string;
  publicRef: string;
  fullNameFa: string;
  fullNameEn: string;
  role: ProfileRole;
  mfaSatisfied: boolean;
}

interface AdminSessionValue {
  session: AdminSession | null;
  loading: boolean;
  error: string | null;
  sections: readonly AdminSection[];
  can: (permission: Permission) => boolean;
  canOpen: (section: AdminSection) => boolean;
  login: (input: { cardNumber: string; password: string; totpCode?: string }) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AdminSessionContext = createContext<AdminSessionValue | null>(null);

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const value = await adminApi.get<AdminSession>('/auth/admin/session');
      setSession(value);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setSession(null);
        setError(null);
      } else {
        setError(describeError(caught));
        setSession(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A session that dies server-side (idle timeout, revocation, absolute expiry) must
  // not leave stale figures on screen.
  useEffect(() => {
    const onLost = () => setSession(null);
    window.addEventListener('pars:admin-session-lost', onLost);
    return () => window.removeEventListener('pars:admin-session-lost', onLost);
  }, []);

  const login = useCallback<AdminSessionValue['login']>(async (input) => {
    setError(null);
    const value = await adminApi.post<AdminSession & { csrfToken: string }>('/auth/admin/login', input, { anonymous: true });
    setCsrfToken(value.csrfToken);

    // The login response proves the *password* was right; it does not prove the
    // browser kept the session cookie. Inside an embedded preview the cookie may be
    // discarded as third-party, and the console would otherwise flash the dashboard
    // and then silently bounce back here. Asking the server once, immediately,
    // turns that invisible failure into an explicit message.
    try {
      await adminApi.get<AdminSession>('/auth/admin/session');
    } catch {
      setCsrfToken(null);
      throw new ApiError(0, {
        code: 'SESSION_COOKIE_BLOCKED',
        messageFa:
          'شناسه و گذرواژه درست بود، ولی مرورگر کوکی نشست را ذخیره نکرد؛ بدون آن ورود کامل نمی‌شود. ' +
          'این حالت وقتی پیش می‌آید که صفحه داخل یک قاب (iframe) یا حالت ناشناس با مسدودسازی کوکی شخص‌ثالث باز شده باشد. ' +
          'پیش‌نمایش را در یک زبانهٔ مستقل باز کنید یا اجازهٔ کوکی‌های شخص‌ثالث را برای این دامنه بدهید.',
      });
    }

    setSession({
      profileId: value.profileId,
      publicRef: value.publicRef,
      fullNameFa: value.fullNameFa,
      fullNameEn: value.fullNameEn,
      role: value.role,
      mfaSatisfied: value.mfaSatisfied,
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await adminApi.post('/auth/admin/logout', {});
    } catch {
      // Logging out is best-effort: the cookie is cleared locally either way.
    }
    setCsrfToken(null);
    setSession(null);
  }, []);

  const value = useMemo<AdminSessionValue>(
    () => ({
      session,
      loading,
      error,
      sections: session ? allowedSections(session.role) : ADMIN_SECTIONS,
      can: (permission) => (session ? can(session.role, permission) : false),
      canOpen: (section) => (session ? canAccessSection(session.role, section) : false),
      login,
      logout,
      reload,
    }),
    [session, loading, error, login, logout, reload],
  );

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession(): AdminSessionValue {
  const context = useContext(AdminSessionContext);
  if (!context) throw new Error('useAdminSession must be used inside AdminSessionProvider');
  return context;
}
