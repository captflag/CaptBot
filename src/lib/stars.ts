import { useSyncExternalStore } from 'react';
import { profileKey } from './auth/profile';

// ponytail: stars live in this browser only, like settings. To sync them across devices,
// add a `starred` column to the threads table and carry it through the sync rows.
const KEY = 'captbot_starred';
const listeners = new Set<() => void>();
/** Cached per profile, so the set keeps its identity between reads (useSyncExternalStore needs that). */
let cached: { key: string; ids: Set<string> } | null = null;

function read(): Set<string> {
  const key = profileKey(KEY);
  if (cached?.key !== key) {
    let ids: Set<string>;
    try {
      ids = new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]);
    } catch {
      ids = new Set();
    }
    cached = { key, ids };
  }
  return cached.ids;
}

/** Stars a chat, or takes its star away. */
export function toggleStar(id: string) {
  const next = new Set(read());
  if (!next.delete(id)) next.add(id);
  const key = profileKey(KEY);
  cached = { key, ids: next };
  try {
    localStorage.setItem(key, JSON.stringify([...next]));
  } catch {
    // Storage blocked: the star lasts until the page is reloaded.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The ids of starred chats; re-renders whenever a star changes anywhere in the app. */
export const useStarred = () => useSyncExternalStore(subscribe, read);
