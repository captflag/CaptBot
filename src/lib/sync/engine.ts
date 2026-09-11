import { useSyncExternalStore } from 'react';
import type { SyncChange, SyncCursors } from '../../../api/_lib/contract';
import { profileKey } from '../auth/profile';
import { db, type CaptBotDB } from '../db';
import { errorText } from '../rag/json';
import type { ChatMessage } from '../types';
import { remote } from './remote';
import { clearDirty, dirtyEntries, isDirty, markDirty, markRemote, onDirty, pendingCount, setTracking, SYNCED_TABLES, type DirtyEntry } from './track';

const CURSORS_KEY = 'captbot_sync_cursors';
const PULLED_KEY = 'captbot_sync_pulled';
const ADOPTED_KEY = 'captbot_sync_adopted';
const MAX_BATCH = 150;
const MAX_BATCH_BYTES = 2_500_000; // under the API's request limit

export interface SyncStatus {
  phase: 'idle' | 'syncing' | 'error';
  lastSyncedAt: number | null;
  /** Local changes not yet on the server. */
  pending: number;
  error?: string;
  /** Changes the server refused this session, and why the last one was refused. */
  rejected: number;
  rejection?: string;
}

const IDLE: SyncStatus = { phase: 'idle', lastSyncedAt: null, pending: 0, rejected: 0 };
let status: SyncStatus = IDLE;
const listeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export const syncStatus = (): SyncStatus => status;

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the next pull starts over, and applying rows twice is harmless.
  }
}

/** Whether this browser has completed a full pull for the signed-in account. */
export const hasPulled = (): boolean => read(profileKey(PULLED_KEY)) === '1';

/** Forgets sync progress, e.g. after the account's data was wiped. */
export function resetSyncState() {
  write(profileKey(CURSORS_KEY), null);
  write(profileKey(PULLED_KEY), null);
}

/** Thrown inside a sync that outlived its account (sign-out or a switch mid-sync); it stops quietly. */
class Superseded extends Error {}

/** Bumped whenever sync stops, so a run still in flight can tell it no longer belongs to the current account. */
let generation = 0;

function check(gen: number) {
  if (gen !== generation) throw new Superseded();
}

/** What a device sends: no image data (it stays on the sending device) and no NUL characters (Postgres can't store them). */
function forPush(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const clean = JSON.parse(JSON.stringify(row), (_key, value: unknown) =>
    typeof value === 'string' && value.includes('\x00') ? value.replace(/\x00/g, '') : value,
  ) as Record<string, unknown>;
  if (table !== 'messages' || !Array.isArray(clean.images)) return clean;
  return { ...clean, images: (clean.images as NonNullable<ChatMessage['images']>).map(({ name, mimeType }) => ({ name, mimeType, data: '' })) };
}

async function pushAll(database: CaptBotDB, gen: number): Promise<void> {
  for (;;) {
    check(gen);
    const entries = dirtyEntries(MAX_BATCH);
    if (!entries.length) return;
    const changes: SyncChange[] = [];
    const sent: DirtyEntry[] = [];
    let bytes = 0;
    for (const table of SYNCED_TABLES) {
      const mine = entries.filter((e) => e.table === table);
      if (!mine.length) continue;
      const rows = await database.table(table).bulkGet(mine.map((e) => e.id));
      mine.forEach((e, i) => {
        const row = rows[i] as Record<string, unknown> | undefined;
        const change: SyncChange = row ? { table, id: e.id, row: forPush(table, row) } : { table, id: e.id };
        const size = JSON.stringify(change).length;
        if (sent.length && bytes + size > MAX_BATCH_BYTES) return;
        bytes += size;
        changes.push(change);
        sent.push(e);
      });
    }
    check(gen);
    const res = await remote().push(changes);
    check(gen);
    // Refused changes leave the queue too: retrying the same bad record would block everything behind it.
    clearDirty(sent);
    if (res.rejected?.length) {
      console.warn('CaptBot sync: the server refused some changes', res.rejected);
      setStatus({ rejected: status.rejected + res.rejected.length, rejection: res.rejected[0].error });
    }
  }
}

function mergeMessage(local: ChatMessage | undefined, incoming: ChatMessage): ChatMessage {
  if (local?.images?.some((i) => i.data) && incoming.images) return { ...incoming, images: local.images };
  return incoming;
}

/** Writes changes that came from the server, without queueing them to be pushed back. */
export async function applyPulled(changes: SyncChange[], database: CaptBotDB = db): Promise<void> {
  if (!changes.length) return;
  const d = database;
  await d.transaction('rw', [d.collections, d.documents, d.docTexts, d.chunks, d.vectors, d.threads, d.messages, d.prompts], async (tx) => {
    markRemote(tx.idbtrans);
    for (const c of changes) {
      // A local edit that hasn't been pushed yet wins until it is.
      if (isDirty(c.table, c.id)) continue;
      if (!c.row) {
        await d.table(c.table).delete(c.id);
        if (c.table === 'documents') {
          await d.docTexts.delete(c.id);
          await d.chunks.where('docId').equals(c.id).delete();
          await d.vectors.where('docId').equals(c.id).delete();
        }
      } else if (c.table === 'messages') {
        const incoming = c.row as unknown as ChatMessage;
        await d.messages.put(mergeMessage(await d.messages.get(c.id), incoming));
      } else {
        await d.table(c.table).put(c.row);
      }
    }
  });
}

async function pullAll(database: CaptBotDB, gen: number, keys: { cursors: string; pulled: string }): Promise<void> {
  let cursors: SyncCursors;
  try {
    cursors = JSON.parse(read(keys.cursors) ?? '{}') as SyncCursors;
  } catch {
    cursors = {};
  }
  for (;;) {
    check(gen);
    const res = await remote().pull(cursors);
    check(gen);
    await applyPulled(res.changes, database);
    check(gen);
    cursors = res.cursors;
    write(keys.cursors, JSON.stringify(cursors));
    if (!res.more) break;
  }
  write(keys.pulled, '1');
}

let running: Promise<void> | null = null;
let again = false;
let retryTimer = 0;
let retryDelay = 0;
let active = false;

function withLock(task: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? (locks.request('captbot-sync', task) as Promise<void>) : task();
}

/**
 * Pushes local changes, then pulls everything that changed on the server. Concurrent calls
 * share one run. The run is tied to the account and database it started with.
 */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  const gen = generation;
  const database = db;
  const keys = { cursors: profileKey(CURSORS_KEY), pulled: profileKey(PULLED_KEY) };
  window.clearTimeout(retryTimer);
  setStatus({ phase: 'syncing' });

  const run: Promise<void> = withLock(async () => {
    do {
      again = false;
      let pushError: unknown = null;
      try {
        await pushAll(database, gen);
      } catch (err) {
        if (err instanceof Superseded) throw err;
        pushError = err;
      }
      // Pull even when the push failed, so this device still receives everyone else's changes.
      await pullAll(database, gen, keys);
      if (pushError) throw pushError;
    } while (again);
  })
    .then(
      () => {
        if (gen !== generation) return;
        retryDelay = 0;
        setStatus({ phase: 'idle', lastSyncedAt: Date.now(), error: undefined });
      },
      (err: unknown) => {
        if (err instanceof Superseded || gen !== generation) return;
        setStatus({ phase: 'error', error: errorText(err) });
        // Back off: 5 s, 10 s, 20 s … up to 5 minutes.
        retryDelay = Math.min(300_000, retryDelay ? retryDelay * 2 : 5_000);
        if (active) retryTimer = window.setTimeout(() => void syncNow(), retryDelay);
      },
    )
    .finally(() => {
      if (running === run) running = null;
      if (gen === generation) setStatus({ pending: pendingCount() });
    });
  running = run;
  return run;
}

let cleanup: (() => void)[] = [];

/** Tracks local writes and keeps the account in sync: now, on focus, when back online, after edits and every minute. */
export function startSync() {
  stopSync();
  active = true;
  setTracking(true);
  let debounce = 0;
  const soon = () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => void syncNow(), 800);
  };
  const onVisible = () => {
    if (!document.hidden) void syncNow();
  };
  const offDirty = onDirty(() => {
    setStatus({ pending: pendingCount() });
    soon();
  });
  window.addEventListener('focus', onVisible);
  window.addEventListener('online', onVisible);
  document.addEventListener('visibilitychange', onVisible);
  const interval = window.setInterval(onVisible, 60_000);
  cleanup = [
    offDirty,
    () => window.removeEventListener('focus', onVisible),
    () => window.removeEventListener('online', onVisible),
    () => document.removeEventListener('visibilitychange', onVisible),
    () => window.clearInterval(interval),
    () => window.clearTimeout(debounce),
  ];
  setStatus({ pending: pendingCount() });
  void syncNow();
}

/** Stops syncing. A run still in flight notices and stops before it touches anything else. */
export function stopSync() {
  generation++;
  active = false;
  running = null;
  again = false;
  cleanup.forEach((f) => f());
  cleanup = [];
  window.clearTimeout(retryTimer);
  setTracking(false);
  status = IDLE;
  listeners.forEach((l) => l());
}

/**
 * Queues this browser's existing collections, chats and saved prompts for upload, once, the first
 * time an account syncs here. Call it before the first pull, so only data made in this browser is
 * queued, never rows pulled from the account. Returns documents indexed only in this browser;
 * the caller uploads those.
 */
export async function adoptLocalRecords(serverEmbeddingKey: string): Promise<string[]> {
  if (hasPulled() || read(profileKey(ADOPTED_KEY)) === '1') return [];
  const [collections, threads, messages, prompts] = await Promise.all([
    db.collections.toCollection().primaryKeys(),
    db.threads.toCollection().primaryKeys(),
    db.messages.toCollection().primaryKeys(),
    db.prompts.toCollection().primaryKeys(),
  ]);
  markDirty('collections', collections);
  markDirty('threads', threads);
  markDirty('messages', messages);
  markDirty('prompts', prompts);
  const docs = await db.documents.filter((d) => d.status === 'ready' && d.embeddingKey !== serverEmbeddingKey).toArray();
  const local: string[] = [];
  for (const d of docs) if ((await db.chunks.where('docId').equals(d.id).count()) > 0) local.push(d.id);
  write(profileKey(ADOPTED_KEY), '1');
  return local;
}
