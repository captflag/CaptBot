import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthGate } from './components/AuthGate';
import { LoginPreview } from './components/LoginPreview';
import { authEnabled } from './lib/auth/session';
import './index.css';

/** Local mode (no Clerk key). In dev, /#login previews the login page so it can be reviewed before Clerk is set up. */
function LocalRoot() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return import.meta.env.DEV && hash === '#login' ? <LoginPreview /> : <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {authEnabled ? (
      <AuthGate>
        <App />
      </AuthGate>
    ) : (
      <LocalRoot />
    )}
  </StrictMode>,
);
