/**
 * Entry point — public application.
 *
 * Provider order matters: the theme must be applied before the first paint of the
 * shell, and the session must resolve before any authenticated route decides what
 * to render.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ToastProvider } from '@parsbank/ui';
import '@parsbank/ui/styles.css';
import { App } from './App.tsx';
import { ContentProvider } from './lib/content.tsx';
import { SessionProvider } from './lib/session.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <ContentProvider>
            <App />
          </ContentProvider>
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
