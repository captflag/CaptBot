import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  ChatMessage,
  Chunk,
  ChunkVector,
  Collection,
  DocText,
  KbDocument,
  SavedPrompt,
  Thread,
} from './types';
import { syncMiddleware } from './sync/track';

export class CaptBotDB extends Dexie {
  collections!: EntityTable<Collection, 'id'>;
  documents!: EntityTable<KbDocument, 'id'>;
  docTexts!: EntityTable<DocText, 'docId'>;
  chunks!: EntityTable<Chunk, 'id'>;
  vectors!: Table<ChunkVector, [string, string]>;
  threads!: EntityTable<Thread, 'id'>;
  messages!: EntityTable<ChatMessage, 'id'>;
  prompts!: EntityTable<SavedPrompt, 'id'>;

  constructor(name = 'captbot') {
    super(name);
    // Queues local writes for the server while server storage is on.
    this.use(syncMiddleware);
    this.version(1).stores({
      collections: 'id, name, createdAt',
      documents: 'id, name, hash, status, *collectionIds, createdAt',
      docTexts: 'docId',
      chunks: 'id, docId',
      vectors: '[chunkId+embeddingKey], docId, embeddingKey',
      threads: 'id, updatedAt',
      messages: 'id, threadId, [threadId+createdAt]',
      prompts: 'id, createdAt',
    });
    // Neighbouring chunks are looked up by position to widen retrieved excerpts.
    this.version(2).stores({ chunks: 'id, docId, [docId+ordinal]' });
  }
}

// `let` so importers see the swap to a signed-in user's own database (ES module live binding).
export let db = new CaptBotDB();

/** Points storage at a user's own database, so accounts sharing a browser never see each other's data. */
export function openDatabaseFor(profileId: string | null) {
  const name = profileId ? `captbot-${profileId}` : 'captbot';
  if (db.name === name) return;
  db.close();
  db = new CaptBotDB(name);
}

export const uid = () => crypto.randomUUID();

export const COLLECTION_COLORS = ['#8B5CF6', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#6366F1', '#14B8A6'];

export async function createCollection(name: string): Promise<Collection> {
  const count = await db.collections.count();
  const collection: Collection = {
    id: uid(),
    name: name.trim().slice(0, 200) || 'Untitled',
    color: COLLECTION_COLORS[count % COLLECTION_COLORS.length],
    createdAt: Date.now(),
  };
  await db.collections.add(collection);
  return collection;
}

export async function deleteCollection(id: string) {
  await db.transaction('rw', [db.collections, db.documents, db.threads], async () => {
    await db.collections.delete(id);
    await db.documents
      .where('collectionIds')
      .equals(id)
      .modify((d) => {
        d.collectionIds = d.collectionIds.filter((c) => c !== id);
      });
    await db.threads
      .filter((t) => t.collectionIds.includes(id))
      .modify((t) => {
        t.collectionIds = t.collectionIds.filter((c) => c !== id);
      });
  });
}

export async function deleteThread(id: string) {
  await db.transaction('rw', [db.threads, db.messages], async () => {
    await db.threads.delete(id);
    await db.messages.where('threadId').equals(id).delete();
  });
}

export async function threadMessages(threadId: string): Promise<ChatMessage[]> {
  return db.messages
    .where('[threadId+createdAt]')
    .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey])
    .toArray();
}

/** IDs of ready documents inside the given collections (all collections when empty). */
export async function scopedReadyDocIds(collectionIds: string[]): Promise<Set<string>> {
  const docs = collectionIds.length
    ? await db.documents.where('collectionIds').anyOf(collectionIds).toArray()
    : await db.documents.toArray();
  return new Set(docs.filter((d) => d.status === 'ready').map((d) => d.id));
}
