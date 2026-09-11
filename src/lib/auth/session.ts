import { openDatabaseFor } from '../db';
import { knowledge } from '../rag/store';
import { reloadSettings } from '../settings';
import { setProfileId } from './profile';

type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;

/**
 * Sign-in is on when a Clerk publishable key is configured. Without one the app
 * runs as a local single-profile tool (own API keys only), which keeps dev simple.
 */
export const authEnabled = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

export function setTokenGetter(getter: TokenGetter | null) {
  tokenGetter = getter;
}

export function getAuthToken(): Promise<string | null> {
  return tokenGetter ? tokenGetter() : Promise.resolve(null);
}

/** Signed-in users can use the free tier: calls made on the server's key, rate limited per user. */
export function serverTierAvailable(): boolean {
  return authEnabled && tokenGetter !== null;
}

/** Points storage and settings at a user's own profile. Call before the app renders. */
export function activateProfile(userId: string | null) {
  setProfileId(userId);
  openDatabaseFor(userId);
  reloadSettings();
  knowledge.invalidate();
}
