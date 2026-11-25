import { ClerkProvider, SignIn, useAuth, useUser } from '@clerk/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { activateProfile, setTokenGetter } from '../lib/auth/session';
import { resetUsage } from '../lib/auth/usage';
import { getSettings, updateSettings } from '../lib/settings';
import { connectStorage, disconnectStorage } from '../lib/sync/connect';
import { plural } from '../lib/utils';
import { LoginPage } from './LoginPage';
import { Logo } from './Logo';
import { signInAppearance, useIsDark } from './signInTheme';
import { toast } from './Toaster';

function Splash() {
  return (
    <div className="flex h-full items-center justify-center bg-canvas dark:bg-canvas">
      <Logo size="md" withWord />
    </div>
  );
}

/** Shows the login page when signed out; when signed in, switches storage to the user's profile and their account data. */
function SessionGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const { user } = useUser();
  const [activeUser, setActiveUser] = useState<string | null>(null);
  const dark = useIsDark();
  const appearance = useMemo(() => signInAppearance(dark), [dark]);

  // The API client asks for a fresh session token on every request.
  useEffect(() => {
    setTokenGetter(isSignedIn ? () => getToken() : null);
  }, [isSignedIn, getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    if (isSignedIn && userId) {
      // Stop any sync for the previous account before storage switches to this one.
      disconnectStorage();
      activateProfile(userId);
      void connectStorage().then((moving) => {
        if (cancelled) return;
        setActiveUser(userId);
        if (moving) toast(`Moving ${plural(moving, 'document')} from this browser into your account…`);
      });
    } else {
      disconnectStorage();
      resetUsage();
      setActiveUser(null);
    }
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, userId]);

  // Greet people by first name unless they've set their own display name.
  const firstName = user?.firstName;
  useEffect(() => {
    if (activeUser && firstName && !getSettings().displayName.trim()) updateSettings({ displayName: firstName });
  }, [activeUser, firstName]);

  if (!isLoaded) return <Splash />;
  if (!isSignedIn) {
    return (
      <LoginPage>
        <SignIn routing="hash" appearance={appearance} />
      </LoginPage>
    );
  }
  // Render the app only once storage points at this user's profile.
  if (activeUser !== userId) return <Splash />;
  return <>{children}</>;
}

export function AuthGate({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      appearance={{ variables: { colorPrimary: '#7c3aed' } }}
    >
      <SessionGate>{children}</SessionGate>
    </ClerkProvider>
  );
}
