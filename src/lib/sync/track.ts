import type { DBCore, DBCoreMutateRequest, DBCoreMutateResponse, DBCoreTransaction, Middleware } from 'dexie';
import type { SyncTable } from '../../../api/_lib/contract';
import { profileKey } from '../auth/profile';

/** Tables that sync with the server. Document text and chunks live on the server; vectors never leave it. */
export const SYNCED_TABLES: readonly SyncTable[] = ['collections', 'documents', 'threads', 'messages', 'prompts'];
const SYNCED = new Set<string>(SYNCED_TABLES);

let enabled = false;
const remoteTransactions = new WeakSet<DBCoreTransaction>();
const listeners = new Set<() => void>();

/** Records writes only while server storage is on; a browser-only profile has nothing to push. */
export function setTracking(on: boolean) {
  enabled = on;
}

/** Marks a transaction as applying changes pulled from the server, so they aren't pushed straight back. */
export function markRemote(trans: DBCoreTransaction) {
  remoteTransactions.add(trans);
}

export function onDirty(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// One localStorage entry per changed record ("captbot_dirty:<user>|<table>|<id>" → stamp). Separate
// entries mean tabs never overwrite each other's lists, and a record changed again after it was
// read for a push gets a new stamp, so the push doesn't clear it.
const PREFIX = 'captbot_dirty';
const entryKey = (table: string, id: string) => `${profileKey(PREFIX)}|${table}|${id}`;
let counter = 0;

/** Queues records for the next push. */
export function markDirty(table: SyncTable, ids: readonly unknown[]) {
  const stamp = `${Date.now()}.${String(counter++ % 1e6).padStart(6, '0')}`;
  try {
    for (const id of ids) if (typeof id === 'string') localStorage.setItem(entryKey(table, id), stamp);
  } catch {
    // Storage full or blocked: the change stays local until the next full sync.
  }
  listeners.forEach((l) => l());
}

export interface DirtyEntry {
  table: SyncTable;
  id: string;
  stamp: string;
}

/** Records waiting to be pushed, oldest first. */
export function dirtyEntries(limit = Infinity): DirtyEntry[] {
  const prefix = `${profileKey(PREFIX)}|`;
  const out: DirtyEntry[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const bar = rest.indexOf('|');
      out.push({ table: rest.slice(0, bar) as SyncTable, id: rest.slice(bar + 1), stamp: localStorage.getItem(key) ?? '' });
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => a.stamp.localeCompare(b.stamp)).slice(0, limit);
}

/** Forgets pushed entries, except those changed again since they were read. */
export function clearDirty(entries: DirtyEntry[]) {
  try {
    for (const e of entries) if (localStorage.getItem(entryKey(e.table, e.id)) === e.stamp) localStorage.removeItem(entryKey(e.table, e.id));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

export function clearAllDirty() {
  clearDirty(dirtyEntries());
}

export function isDirty(table: SyncTable, id: string): boolean {
  try {
    return localStorage.getItem(entryKey(table, id)) !== null;
  } catch {
    return false;
  }
}

export const pendingCount = () => dirtyEntries().length;

/**
 * Dexie middleware that queues every local write to a synced table for the next push.
 * It sits below Dexie's own API, so bulk updates and deletes are caught along with single writes.
 */
export const syncMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'captbot-sync',
  create(down) {
    return {
      ...down,
      table(name) {
        const table = down.table(name);
        if (!SYNCED.has(name)) return table;
        return {
          ...table,
          async mutate(req: DBCoreMutateRequest): Promise<DBCoreMutateResponse> {
            const res = await table.mutate(req);
            if (enabled && !remoteTransactions.has(req.trans)) {
              const ok = (_: unknown, i: number) => !res.failures[i];
              if (req.type === 'add' || req.type === 'put') markDirty(name as SyncTable, (res.results ?? req.keys ?? []).filter(ok));
              else if (req.type === 'delete') markDirty(name as SyncTable, req.keys.filter(ok));
              // deleteRange (Table.clear) only happens when wiping everything, which the server handles itself.
            }
            return res;
          },
        };
      },
    };
  },
};
