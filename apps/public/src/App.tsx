/**
 * Routing table — public application.
 *
 * Two route families are deliberately outside the authenticated shell:
 *   • `/secure/card/:token` — the page behind the QR printed on a physical card.
 *     It is public by design and reveals branding, card number and expiry only.
 *   • `/login` — the only place a session can be created.
 */
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { BrandMark, Loading, PublicShell, ThemeStyle, roleFa } from '@parsbank/ui';
import { useContent } from './lib/content.tsx';
import { useSession } from './lib/session.tsx';
import { Landing } from './pages/Landing.tsx';
import { Login } from './pages/Login.tsx';
import { SecureCard } from './pages/SecureCard.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { WalletPage } from './pages/Wallet.tsx';
import { Send } from './pages/Send.tsx';
import { Receive } from './pages/Receive.tsx';
import { Scan } from './pages/Scan.tsx';
import { QrPay } from './pages/QrPay.tsx';
import { CardPage } from './pages/CardPage.tsx';
import { History } from './pages/History.tsx';
import { TransactionDetail } from './pages/TransactionDetail.tsx';
import { ReceiptVerify } from './pages/ReceiptVerify.tsx';
import { Banknotes } from './pages/Banknotes.tsx';
import { Profile } from './pages/Profile.tsx';
import { Security } from './pages/Security.tsx';
import { NotFound } from './pages/NotFound.tsx';

function ShellLayout() {
  const { headerNav } = useContent();
  const { session, logout } = useSession();
  return (
    <PublicShell
      navItems={headerNav}
      session={session ? { fullNameFa: session.fullNameFa, roleFa: roleFa(session.role) } : null}
      onLogout={session ? () => void logout() : undefined}
      footer={<span>پشتیبانی داخلی: کارگزار شبکهٔ بستهٔ پارس · بدون اتصال به شبکه‌های پرداخت عمومی</span>}
    >
      <Outlet />
    </PublicShell>
  );
}

function RequireSession() {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="prs-container prs-container-narrow">
        <div className="prs-panel" style={{ marginTop: 'var(--prs-space-10)' }}>
          <Loading label="در حال بررسی نشست…" />
        </div>
      </div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <Outlet />;
}

export function App() {
  const { theme, loading } = useContent();

  return (
    <>
      <ThemeStyle tokens={theme?.tokens} />
      {loading && !theme ? (
        <div className="prs-secure">
          <div className="prs-stack" style={{ alignItems: 'center', gap: 'var(--prs-space-4)' }}>
            <BrandMark size={56} />
            <Loading label="در حال اتصال به بانک پارس…" />
          </div>
        </div>
      ) : null}
      <Routes>
        {/* Public, no shell: the QR landing page and the sign-in screen. */}
        <Route path="/secure/card/:token" element={<SecureCard />} />
        <Route path="/login" element={<Login />} />
        <Route path="/recover" element={<Login />} />

        {/* Everything below renders inside the account shell. */}
        <Route element={<ShellLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/receipts" element={<ReceiptVerify />} />
          <Route path="/banknotes/verify" element={<Banknotes standalone />} />

          <Route element={<RequireSession />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/wallet/:walletRef" element={<WalletPage />} />
            <Route path="/send" element={<Send />} />
            <Route path="/receive" element={<Receive />} />
            <Route path="/scan" element={<Scan />} />
            <Route path="/qr/:sessionRef" element={<QrPay />} />
            <Route path="/card" element={<CardPage />} />
            <Route path="/history" element={<History />} />
            <Route path="/transactions/:reference" element={<TransactionDetail />} />
            <Route path="/banknotes" element={<Banknotes />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/security" element={<Security />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
