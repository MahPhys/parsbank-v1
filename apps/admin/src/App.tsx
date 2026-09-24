/**
 * APPLICATION ROUTER — operations console.
 *
 * The layout resolves the current section from the URL and asks the session layer
 * whether this role may open it. A route the role cannot open renders a refusal
 * panel instead of the section, which mirrors what the API would answer anyway.
 */
import { useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AdminShell, Alert, Loading, roleFa } from '@parsbank/ui';
import { canAccessSection, type AdminSection } from '@parsbank/domain';
import { adminApi } from './lib/api.ts';
import { useAdminSession } from './lib/session.tsx';
import { navForRole, navEntryForPath } from './lib/nav.ts';
import { usePolling, useAsync } from './lib/hooks.ts';

import { AdminLogin } from './sections/AdminLogin.tsx';
import { NotFoundSection } from './sections/NotFound.tsx';
import { Overview } from './sections/Overview.tsx';
import { Users } from './sections/Users.tsx';
import { Wallets } from './sections/Wallets.tsx';
import { Cards } from './sections/Cards.tsx';
import { Transactions } from './sections/Transactions.tsx';
import { Treasury } from './sections/Treasury.tsx';
import { Issuance } from './sections/Issuance.tsx';
import { Burning } from './sections/Burning.tsx';
import { Banknotes } from './sections/Banknotes.tsx';
import { ExchangeRates } from './sections/ExchangeRates.tsx';
import { Reserve } from './sections/Reserve.tsx';
import { Audit } from './sections/Audit.tsx';
import { Approvals } from './sections/Approvals.tsx';
import { Cms } from './sections/Cms.tsx';
import { DesignSystemSection } from './sections/DesignSystem.tsx';
import { Assets } from './sections/Assets.tsx';
import { FeatureFlags } from './sections/FeatureFlags.tsx';
import { Security } from './sections/Security.tsx';
import { SystemHealth } from './sections/SystemHealth.tsx';

function Refused({ section }: { section: AdminSection }) {
  return (
    <Alert tone="critical" title="این بخش برای نقش شما باز نیست">
      نقش‌ها در بانک پارس یکدیگر را به ارث نمی‌برند. نشست شما اجازهٔ ورود به بخش «{section}» را ندارد و سرور
      هم این درخواست را رد می‌کند؛ نمایش ندادن، تنها یک ملاحظهٔ ظاهری است.
    </Alert>
  );
}

function SectionGuard({ section, children }: { section: AdminSection; children: React.ReactNode }) {
  const { session } = useAdminSession();
  if (!session || !canAccessSection(session.role, section)) return <Refused section={section} />;
  return <>{children}</>;
}

/** The console frame: sidebar, header, live counters, and the refusal-safe outlet. */
function ConsoleLayout() {
  const { session, logout } = useAdminSession();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const approvals = useAsync<{ total: number }>(
    () => adminApi.get<{ total: number }>('/admin/approvals', { query: { status: 'PENDING', pageSize: 1 } }),
    [],
  );
  const health = useAsync<{ status: 'OK' | 'DEGRADED' | 'CRITICAL' }>(() => adminApi.get('/admin/health'), []);

  usePolling(() => {
    void approvals.reload();
    void health.reload();
  }, 45_000, Boolean(session));

  const entry = navEntryForPath(location.pathname);

  if (!session) return <Navigate to="/login" replace />;

  return (
    <AdminShell
      sections={navForRole(session.role)}
      title={entry?.labelFa ?? 'کنسول عملیات'}
      subtitle={
        session.role === 'DESIGN_ADMIN'
          ? 'دسترسی شما به بخش‌های طراحی و محتوا محدود است و هیچ اختیار پولی ندارید.'
          : `نقش: ${roleFa(session.role)}${session.mfaSatisfied ? '' : ' — عامل دوم تأیید نشده'}`
      }
      session={{ fullNameFa: session.fullNameFa, roleFa: roleFa(session.role) }}
      onLogout={() => void logout()}
      pendingApprovals={approvals.data?.total ?? 0}
      apiStatus={health.error ? 'UNKNOWN' : (health.data?.status ?? 'UNKNOWN')}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={() => setSidebarOpen((open) => !open)}
    >
      <Outlet />
    </AdminShell>
  );
}

export function App() {
  const { session, loading, error } = useAdminSession();

  if (loading) return <Loading label="در حال بررسی نشست مدیریتی…" />;
  if (error) {
    return (
      <div className="prs-container prs-container-narrow" style={{ paddingBlock: 'var(--prs-space-8)' }}>
        <Alert tone="critical" title="ارتباط با سامانه برقرار نشد">
          {error}
        </Alert>
      </div>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<AdminLogin />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/admin" replace />} />
      <Route element={<ConsoleLayout />}>
        <Route path="/admin" element={<SectionGuard section="overview"><Overview /></SectionGuard>} />
        <Route path="/admin/approvals" element={<Approvals />} />
        <Route path="/admin/users" element={<SectionGuard section="users"><Users /></SectionGuard>} />
        <Route path="/admin/wallets" element={<SectionGuard section="wallets"><Wallets /></SectionGuard>} />
        <Route path="/admin/cards" element={<SectionGuard section="cards"><Cards /></SectionGuard>} />
        <Route path="/admin/transactions" element={<SectionGuard section="transactions"><Transactions /></SectionGuard>} />
        <Route path="/admin/treasury" element={<SectionGuard section="treasury"><Treasury /></SectionGuard>} />
        <Route path="/admin/issuance" element={<SectionGuard section="issuance"><Issuance /></SectionGuard>} />
        <Route path="/admin/burning" element={<SectionGuard section="burning"><Burning /></SectionGuard>} />
        <Route path="/admin/banknotes" element={<SectionGuard section="banknotes"><Banknotes /></SectionGuard>} />
        <Route path="/admin/exchange-rates" element={<SectionGuard section="exchange-rates"><ExchangeRates /></SectionGuard>} />
        <Route path="/admin/reserve" element={<SectionGuard section="reserve"><Reserve /></SectionGuard>} />
        <Route path="/admin/audit" element={<SectionGuard section="audit"><Audit /></SectionGuard>} />
        <Route path="/admin/cms" element={<SectionGuard section="cms"><Cms /></SectionGuard>} />
        <Route path="/admin/design-system" element={<SectionGuard section="design-system"><DesignSystemSection /></SectionGuard>} />
        <Route path="/admin/assets" element={<SectionGuard section="assets"><Assets /></SectionGuard>} />
        <Route path="/admin/feature-flags" element={<SectionGuard section="feature-flags"><FeatureFlags /></SectionGuard>} />
        <Route path="/admin/security" element={<SectionGuard section="security"><Security /></SectionGuard>} />
        <Route path="/admin/system-health" element={<SectionGuard section="system-health"><SystemHealth /></SectionGuard>} />
        <Route path="*" element={<NotFoundSection />} />
      </Route>
    </Routes>
  );
}
