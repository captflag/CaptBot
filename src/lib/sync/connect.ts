import { profileKey } from '../auth/profile';
import { uploadLocalDocument } from '../rag/ingest';
import { ProviderError } from '../providers/types';
import { adoptLocalRecords, hasPulled, startSync, stopSync, syncNow } from './engine';
import { setStorageMode } from './mode';
import { remote } from './remote';

// Remembers that this account uses server storage, so an offline start keeps tracking changes.
const MODE_KEY = 'captbot_server_storage';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function remembered(): string | null {
  try {
    return localStorage.getItem(profileKey(MODE_KEY));
  } catch {
    return null;
  }
}

function remember(embeddingKey: string | null) {
  try {
    if (embeddingKey) localStorage.setItem(profileKey(MODE_KEY), embeddingKey);
    else localStorage.removeItem(profileKey(MODE_KEY));
  } catch {
    // ignore
  }
}

/**
 * The server answered and said it has no storage: a 503 (no database), a 404, or a success that
 * isn't JSON (the API isn't running here). A network failure has no status and means offline.
 */
const notConfigured = (err: unknown) =>
  err instanceof ProviderError && typeof err.status === 'number' && (err.status === 503 || err.status === 404 || err.status < 300);

// Each connect gets a number; a newer connect or a disconnect makes an older one give up.
let attempt = 0;

/**
 * Switches the signed-in account to server storage when the API has a database, and brings this
 * browser up to date. The first sync on a browser is waited for (a few seconds at most) so the
 * app opens with the account's data; later ones run in the background.
 * Resolves to the number of browser-only documents queued to move into the account.
 */
export async function connectStorage(): Promise<number> {
  disconnectStorage();
  const mine = ++attempt;
  const stale = () => mine !== attempt;

  let embeddingKey: string;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    embeddingKey = (await remote().status(controller.signal)).embeddingKey;
    remember(embeddingKey);
  } catch (err) {
    const known = remembered();
    if (!known || notConfigured(err)) {
      if (notConfigured(err)) remember(null);
      return 0; // this browser only
    }
    embeddingKey = known; // offline or a server hiccup: keep tracking and sync once it's reachable
  } finally {
    clearTimeout(timer);
  }
  if (stale()) return 0;

  // Queue what this browser already had before the first pull, so pulled rows are never queued.
  const first = !hasPulled();
  const local = await adoptLocalRecords(embeddingKey);
  if (stale()) return 0;

  setStorageMode({ server: true, embeddingKey });
  startSync();
  if (first) await Promise.race([syncNow(), sleep(8000)]);
  if (stale()) return 0;

  for (const id of local) void uploadLocalDocument(id);
  return local.length;
}

export function disconnectStorage() {
  attempt++;
  stopSync();
  setStorageMode({ server: false, embeddingKey: null });
}
