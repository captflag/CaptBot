import { useLiveQuery } from 'dexie-react-hooks';
import { profileKey } from './auth/profile';
import { db } from './db';

/** Stars a chat, or takes its star away. Stored on the chat itself, so it syncs with the account. */
export async function toggleStar(id: string) {
  const thread = await db.threads.get(id);
  if (thread) await db.threads.update(id, { starred: !thread.starred });
}

const EMPTY = new Set<string>();

/** The ids of starred chats. */
export const useStarred = (): Set<string> => useLiveQuery(async () => new Set(await db.threads.filter((t) => Boolean(t.starred)).primaryKeys()), [], EMPTY);

/** Stars used to live in localStorage; moves any left there onto their chats, once. */
export async function adoptLegacyStars() {
  const key = profileKey('captbot_starred');
  let ids: string[];
  try {
    ids = JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
  } catch {
    return;
  }
  if (!ids.length) return;
  // Chats not on this device yet (still to be pulled from the account) keep their entry for next time.
  const left: string[] = [];
  for (const id of ids) if (!(await db.threads.update(id, { starred: true }))) left.push(id);
  try {
    if (left.length) localStorage.setItem(key, JSON.stringify(left));
    else localStorage.removeItem(key);
  } catch {
    // Storage blocked: the move runs again next time, which is harmless.
  }
}
