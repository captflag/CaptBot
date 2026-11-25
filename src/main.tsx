import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { authEnabled } from './lib/auth/session';
import './index.css';

// Sign-in (Clerk and the login page) is only downloaded on deployments that use it.
const AuthGate = lazy(() => import('./components/AuthGate').then((m) => ({ default: m.AuthGate })));
const LoginPreview = lazy(() => import('./components/LoginPreview').then((m) => ({ default: m.LoginPreview })));

/** Local mode (no Clerk key). In dev, /#login previews the login page so it can be reviewed before Clerk is set up. */
function LocalRoot() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return import.meta.env.DEV && hash === '#login' ? (
    <Suspense fallback={null}>
      <LoginPreview />
    </Suspense>
  ) : (
    <App />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {authEnabled ? (
      <Suspense fallback={null}>
        <AuthGate>
          <App />
        </AuthGate>
      </Suspense>
    ) : (
      <LocalRoot />
    )}
  </StrictMode>,
);
