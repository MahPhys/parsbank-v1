/**
 * Operations console entry point.
 *
 * The console is served from /admin/ by the same process that serves the API, so
 * every request is same-origin: the ADMIN session cookie is sent automatically and
 * no secret ever lives in this bundle.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ToastProvider, ThemeStyle } from '@parsbank/ui';
import '@parsbank/ui/styles.css';
import { App } from './App.tsx';
import { AdminSessionProvider } from './lib/session.tsx';
import { adminApi } from './lib/api.ts';

/**
 * Applies the published design tokens. A console that looks different from the
 * member site would hide drift, so the same compiled theme drives both.
 */
function ThemeBridge({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    void adminApi
      .get<{ tokens?: Record<string, string> }>('/content/theme', { anonymous: true })
      .then((value) => setTokens(value.tokens ?? null))
      .catch(() => setTokens(null));
  }, []);
  return (
    <>
      <ThemeStyle tokens={tokens} />
      {children}
    </>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('BANK PARS admin: #root is missing');

createRoot(container).render(
  <StrictMode>
    <ThemeBridge>
      <BrowserRouter basename="/admin">
        <ToastProvider>
          <AdminSessionProvider>
            <App />
          </AdminSessionProvider>
        </ToastProvider>
      </BrowserRouter>
    </ThemeBridge>
  </StrictMode>,
);
