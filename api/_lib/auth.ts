import { createClerkClient } from '@clerk/backend';

type Env = Record<string, string | undefined>;

/**
 * Verifies the Clerk session token the browser sends as `Authorization: Bearer <token>`.
 * Returns null when Clerk isn't configured, so the caller can fail closed.
 */
export function clerkAuthenticator(env: Env): ((req: Request) => Promise<string | null>) | null {
  const secretKey = env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) return null;
  const clerk = createClerkClient({
    secretKey,
    publishableKey: env.CLERK_PUBLISHABLE_KEY ?? env.VITE_CLERK_PUBLISHABLE_KEY,
  });
  // Origins allowed to call the API (checked against the token's azp claim).
  const authorizedParties = (env.CLERK_AUTHORIZED_PARTIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return async (req: Request) => {
    const state = await clerk.authenticateRequest(req, {
      authorizedParties: authorizedParties.length ? authorizedParties : undefined,
      jwtKey: env.CLERK_JWT_KEY?.trim() || undefined,
    });
    if (!state.isAuthenticated) return null;
    return state.toAuth()?.userId ?? null;
  };
}
