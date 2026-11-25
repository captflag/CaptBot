import postgres from 'postgres';
import type { PushResponse, SearchChunk, SyncChange, SyncCursors, SyncTable } from './contract.js';
import type { DataStore } from './datastore.js';
import { HttpError } from './handlers.js';

const PAGE = 500;
const TABLES: SyncTable[] = ['collections', 'documents', 'threads', 'messages', 'prompts'];
const MAX_MESSAGE_DATA = 1_000_000;

type Row = postgres.Row;

export interface PgStoreOptions {
  /** Most characters of document text one account may store. */
  maxChars: number;
}

/** A Postgres error caused by the data itself: a bad value (class 22) or a constraint it breaks (class 23). */
const recordError = (err: unknown) => err instanceof postgres.PostgresError && /^2[23]/.test(err.code);

/** Postgres text can't hold NUL characters; drop them instead of rejecting the change. */
const dropNul = (s: string) => (s.includes('\x00') ? s.replace(/\x00/g, '') : s);

// Field readers for rows a device pushes: the expected type, or that change is rejected.
function text(v: unknown, max: number, field: string): string {
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be a string.`);
  const s = dropNul(v);
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters.`);
  return s;
}
const optText = (v: unknown, max: number, field: string): string | null => (v === undefined || v === null ? null : text(v, max, field));
function num(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new HttpError(400, `${field} must be a number.`);
  return v;
}
function ids(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || v.length > 1000 || !v.every((s) => typeof s === 'string' && s.length <= 128)) {
    throw new HttpError(400, `${field} must be a list of ids.`);
  }
  return v as string[];
}

/**
 * A cursor is "txid|id" of the last row a device received. Rows are paged in the order their
 * transactions started, and a pull only sees transactions older than any still running, so a
 * slow write can't commit behind a cursor that has already moved past it.
 */
function splitCursor(cursor: string | undefined): [string, string] {
  if (!cursor) return ['0', ''];
  const bar = cursor.indexOf('|');
  const tx = bar === -1 ? cursor : cursor.slice(0, bar);
  // A cursor from before sync-by-commit (a timestamp) starts over; re-applying rows is harmless.
  return /^\d+$/.test(tx) ? [tx, bar === -1 ? '' : cursor.slice(bar + 1)] : ['0', ''];
}

const toCollection = (r: Row) => ({ id: r.id, name: r.name, color: r.color, createdAt: r.created_at });

const toDocument = (r: Row) => ({
  id: r.id,
  name: r.name,
  sourceType: r.source_type,
  mimeType: r.mime_type,
  url: r.url ?? undefined,
  hash: r.hash,
  collectionIds: r.collection_ids,
  charCount: r.char_count,
  chunkCount: r.chunk_count,
  pageCount: r.page_count ?? undefined,
  status: r.status,
  progress: r.progress,
  error: r.error ?? undefined,
  embeddingKey: r.embedding_key ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toThread = (r: Row) => ({
  id: r.id,
  title: r.title,
  collectionIds: r.collection_ids,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  starred: r.starred,
});

const toMessage = (r: Row) => ({ ...(r.data ?? {}), id: r.id, threadId: r.thread_id, role: r.role, content: r.content, createdAt: r.created_at });

const toPrompt = (r: Row) => ({ id: r.id, text: r.text, createdAt: r.created_at });

const MAPPERS: Record<SyncTable, (r: Row) => Record<string, unknown>> = {
  collections: toCollection,
  documents: toDocument,
  threads: toThread,
  messages: toMessage,
  prompts: toPrompt,
};

const toChunk = (r: Row): SearchChunk => ({
  id: r.id,
  docId: r.doc_id,
  ordinal: r.ordinal,
  start: r.start_char,
  end: r.end_char,
  text: r.text,
  prefix: r.prefix ?? undefined,
  headingPath: r.heading_path,
  page: r.page ?? undefined,
  pageEnd: r.page_end ?? undefined,
});

/** Everything on a message beyond its columns, without NUL characters. Image data stays on the device that sent it. */
function messageData(row: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, threadId: _thread, role: _role, content: _content, createdAt: _created, images, ...rest } = row;
  const data: Record<string, unknown> = { ...rest };
  if (Array.isArray(images)) {
    data.images = images.map((img: { name?: unknown; mimeType?: unknown }) => ({
      name: typeof img?.name === 'string' ? img.name : 'image',
      mimeType: typeof img?.mimeType === 'string' ? img.mimeType : '',
      data: '',
    }));
  }
  const json = JSON.stringify(data);
  if (json.length > MAX_MESSAGE_DATA) throw new HttpError(413, 'A message is too large to sync.');
  return JSON.parse(json, (_key, value: unknown) => (typeof value === 'string' ? dropNul(value) : value)) as Record<string, unknown>;
}

/**
 * The account knowledge base in Postgres (the `captbot` schema). Connects through Supabase's
 * transaction pooler; every statement filters on user_id.
 */
export function pgStore(url: string, opts: PgStoreOptions): DataStore {
  const sql = postgres(url, {
    // The transaction pooler (port 6543) doesn't support prepared statements.
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    // Timestamps are epoch-ms bigints; they fit exactly in a double.
    types: { bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) } },
  });

  const docColumns = sql`id, name, source_type, mime_type, url, hash, collection_ids, char_count, chunk_count, page_count,
    status, progress, error, embedding_key, created_at, updated_at`;
  const chunkColumns = sql`c.id, c.doc_id, c.ordinal, c.start_char, c.end_char, c.text, c.prefix, c.heading_path, c.page, c.page_end`;

  function pullRows(table: SyncTable, userId: string, sinceTx: string, sinceId: string) {
    // Only rows written by transactions older than the oldest one still running: anything newer
    // waits for the next pull, by which time everything before it has committed.
    const where = sql`user_id = ${userId}
      and (txid, id) > (${sinceTx}::xid8, ${sinceId})
      and txid < pg_snapshot_xmin(pg_current_snapshot())`;
    const page = sql`order by txid, id limit ${PAGE + 1}`;
    switch (table) {
      case 'collections':
        return sql`select id, name, color, created_at, deleted, txid::text as tx from captbot.collections where ${where} ${page}`;
      case 'documents':
        return sql`select ${docColumns}, deleted, txid::text as tx from captbot.documents where ${where} ${page}`;
      case 'threads':
        return sql`select id, title, collection_ids, created_at, updated_at, starred, deleted, txid::text as tx from captbot.threads where ${where} ${page}`;
      case 'messages':
        return sql`select id, thread_id, role, content, created_at, data, deleted, txid::text as tx from captbot.messages where ${where} ${page}`;
      case 'prompts':
        return sql`select id, text, created_at, deleted, txid::text as tx from captbot.prompts where ${where} ${page}`;
    }
  }

  async function applyChange(tx: postgres.TransactionSql, u: string, { table, id, row }: SyncChange): Promise<number> {
    if (!row) {
      switch (table) {
        case 'collections':
          return (await tx`update captbot.collections set deleted = true where user_id = ${u} and id = ${id} and not deleted`).count;
        case 'documents':
          await tx`delete from captbot.chunks where user_id = ${u} and doc_id = ${id}`;
          await tx`delete from captbot.doc_texts where user_id = ${u} and doc_id = ${id}`;
          return (await tx`update captbot.documents set deleted = true, hash = '' where user_id = ${u} and id = ${id} and not deleted`).count;
        case 'threads':
          await tx`update captbot.messages set deleted = true, content = '', data = '{}' where user_id = ${u} and thread_id = ${id} and not deleted`;
          return (await tx`update captbot.threads set deleted = true where user_id = ${u} and id = ${id} and not deleted`).count;
        case 'messages':
          return (await tx`update captbot.messages set deleted = true, content = '', data = '{}' where user_id = ${u} and id = ${id} and not deleted`).count;
        case 'prompts':
          return (await tx`update captbot.prompts set deleted = true where user_id = ${u} and id = ${id} and not deleted`).count;
      }
    }

    switch (table) {
      case 'collections':
        return (
          await tx`insert into captbot.collections (user_id, id, name, color, created_at)
            values (${u}, ${id}, ${text(row.name, 500, 'name')}, ${text(row.color ?? '#8B5CF6', 32, 'color')}, ${num(row.createdAt, 'createdAt')})
            on conflict (user_id, id) do update set name = excluded.name, color = excluded.color, deleted = false`
        ).count;
      case 'documents': {
        // Text, chunks and status belong to the upload. A device can only rename a document,
        // change its collections, or mark an unfinished upload as failed.
        const name = text(row.name, 500, 'name');
        const collections = ids(row.collectionIds, 'collectionIds');
        const failed = row.status === 'error';
        const error = optText(row.error, 2000, 'error');
        const changed = (
          await tx`update captbot.documents set
              name = ${name},
              collection_ids = ${collections}::text[],
              status = case when ${failed} and status not in ('ready', 'error') then 'error' else status end,
              error = case when ${failed} and status not in ('ready', 'error') then ${error} else error end
            where user_id = ${u} and id = ${id} and not deleted
              and (name <> ${name} or collection_ids <> ${collections}::text[] or (${failed} and status not in ('ready', 'error')))`
        ).count;
        // Nothing here to change, or the document is gone: re-stamp the row so the device pulls
        // the server's version again (it skipped that pull while its own copy was waiting to push).
        if (!changed) await tx`update captbot.documents set deleted = deleted where user_id = ${u} and id = ${id}`;
        return changed;
      }
      case 'threads':
        return (
          await tx`insert into captbot.threads (user_id, id, title, collection_ids, created_at, updated_at, starred)
            values (${u}, ${id}, ${text(row.title, 500, 'title')}, ${ids(row.collectionIds, 'collectionIds')}::text[],
                    ${num(row.createdAt, 'createdAt')}, ${num(row.updatedAt, 'updatedAt')}, ${row.starred === true})
            on conflict (user_id, id) do update set
              title = excluded.title, collection_ids = excluded.collection_ids, updated_at = excluded.updated_at,
              starred = excluded.starred, deleted = false`
        ).count;
      case 'messages': {
        if (row.role !== 'user' && row.role !== 'assistant') throw new HttpError(400, 'role must be "user" or "assistant".');
        return (
          await tx`insert into captbot.messages (user_id, id, thread_id, role, content, created_at, data)
            values (${u}, ${id}, ${text(row.threadId, 128, 'threadId')}, ${row.role}, ${text(row.content, 400_000, 'content')},
                    ${num(row.createdAt, 'createdAt')}, ${tx.json(messageData(row) as postgres.JSONValue)})
            on conflict (user_id, id) do update set
              thread_id = excluded.thread_id, role = excluded.role, content = excluded.content,
              created_at = excluded.created_at, data = excluded.data, deleted = false`
        ).count;
      }
      case 'prompts':
        return (
          await tx`insert into captbot.prompts (user_id, id, text, created_at)
            values (${u}, ${id}, ${text(row.text, 20_000, 'text')}, ${num(row.createdAt, 'createdAt')})
            on conflict (user_id, id) do update set text = excluded.text, deleted = false`
        ).count;
    }
  }

  return {
    async pull(userId, cursors) {
      const changes: SyncChange[] = [];
      const next: SyncCursors = { ...cursors };
      let more = false;
      for (const table of TABLES) {
        const [sinceTx, sinceId] = splitCursor(cursors[table]);
        const rows = await pullRows(table, userId, sinceTx, sinceId);
        const page = rows.slice(0, PAGE);
        if (rows.length > PAGE) more = true;
        for (const r of page) changes.push({ table, id: r.id, row: r.deleted ? undefined : MAPPERS[table](r) });
        const last = page[page.length - 1];
        if (last) next[table] = `${last.tx}|${last.id}`;
      }
      return { changes, cursors: next, more };
    },

    async push(userId, changes) {
      return sql.begin(async (tx) => {
        let applied = 0;
        const rejected: PushResponse['rejected'] = [];
        for (const change of changes) {
          try {
            // Each change in its own savepoint: one bad record is reported back instead of failing the batch.
            applied += await tx.savepoint((sp) => applyChange(sp, userId, change));
          } catch (err) {
            // Only a problem with the record itself is a rejection. Anything else (a lost connection,
            // a timeout) fails the whole push, so the device keeps its changes and retries.
            if (!(err instanceof HttpError) && !recordError(err)) throw err;
            if (!(err instanceof HttpError)) console.error(err);
            rejected.push({ table: change.table, id: change.id, error: err instanceof HttpError ? err.message : 'The server could not store this change.' });
          }
        }
        return { applied, rejected };
      });
    },

    async createDocument(userId, b) {
      return sql.begin(async (tx) => {
        const [existing] = await tx`select ${docColumns}, deleted from captbot.documents where user_id = ${userId} and id = ${b.id}`;
        // Already indexed with this exact text (a re-import, or a retry after it finished): nothing to do.
        if (existing && !existing.deleted && existing.status === 'ready' && existing.hash === b.hash) return { duplicateOf: toDocument(existing) };

        const [dup] = await tx`select id from captbot.documents
          where user_id = ${userId} and hash = ${b.hash} and id <> ${b.id} and not deleted and status <> 'error' limit 1`;
        if (dup) {
          const [merged] = await tx`update captbot.documents
            set collection_ids = array(select distinct unnest(collection_ids || ${b.collectionIds}::text[]))
            where user_id = ${userId} and id = ${dup.id}
            returning ${docColumns}`;
          return { duplicateOf: toDocument(merged) };
        }

        const [{ used }] = await tx`select coalesce(sum(char_count), 0)::bigint as used from captbot.documents
          where user_id = ${userId} and not deleted and id <> ${b.id}`;
        if (used + b.charCount > opts.maxChars) {
          throw new HttpError(
            413,
            `Your account's storage is full (${Math.round(opts.maxChars / 1_000_000)} million characters of text). Remove some documents to add more.`,
          );
        }
        if (existing) {
          // Starting this document over: clear what an earlier upload left behind.
          await tx`delete from captbot.chunks where user_id = ${userId} and doc_id = ${b.id}`;
          await tx`delete from captbot.doc_texts where user_id = ${userId} and doc_id = ${b.id}`;
        }
        const now = Date.now();
        await tx`insert into captbot.documents
            (user_id, id, name, source_type, mime_type, url, hash, collection_ids, char_count, chunk_count, page_count, status, progress, created_at, updated_at)
          values (${userId}, ${b.id}, ${b.name}, ${b.sourceType}, ${b.mimeType}, ${b.url ?? null}, ${b.hash}, ${b.collectionIds}::text[],
                  ${b.charCount}, ${b.chunkCount}, ${b.pageCount ?? null}, 'embedding', 0, ${b.createdAt}, ${now})
          on conflict (user_id, id) do update set
            name = excluded.name, hash = excluded.hash, collection_ids = excluded.collection_ids, char_count = excluded.char_count,
            chunk_count = excluded.chunk_count, page_count = excluded.page_count, status = 'embedding', progress = 0, error = null,
            embedding_key = null, deleted = false, updated_at = excluded.updated_at`;
        await tx`insert into captbot.doc_texts (user_id, doc_id, page_offsets, expected_length)
          values (${userId}, ${b.id}, ${b.pageOffsets ?? null}::int[], ${b.textLength})`;
        return {};
      });
    },

    async appendText(userId, { docId, index, text: part }) {
      const updated = await sql`update captbot.doc_texts set text = text || ${part}, parts = parts + 1
        where user_id = ${userId} and doc_id = ${docId} and parts = ${index}
          and char_length(text) + char_length(${part}) <= expected_length`;
      if (updated.count) return;
      const [current] = await sql`select parts from captbot.doc_texts where user_id = ${userId} and doc_id = ${docId}`;
      if (!current) throw new HttpError(404, 'Document not found.');
      if (current.parts > index) return; // a retry of a part already stored
      if (current.parts < index) throw new HttpError(409, `Expected text part ${current.parts}, got ${index}.`);
      throw new HttpError(413, 'This text would make the document longer than it was declared to be.');
    },

    async documentName(userId, docId) {
      const [doc] = await sql`select name from captbot.documents where user_id = ${userId} and id = ${docId} and not deleted`;
      return doc ? doc.name : null;
    },

    async addChunks(userId, docId, chunks, embeddingKey) {
      const rows = chunks.map((c) => ({
        id: c.id,
        ordinal: c.ordinal,
        start_char: c.start,
        end_char: c.end,
        text: c.text,
        prefix: c.prefix ?? null,
        heading_path: c.headingPath,
        page: c.page ?? null,
        page_end: c.pageEnd ?? null,
        title: c.title,
        embedding: `[${c.embedding.join(',')}]`,
      }));
      return sql.begin(async (tx) => {
        const inserted = await tx`
          insert into captbot.chunks
            (user_id, id, doc_id, ordinal, start_char, end_char, text, prefix, heading_path, page, page_end, title, embedding)
          select ${userId}, x.id, ${docId}, x.ordinal, x.start_char, x.end_char, x.text, x.prefix, x.heading_path, x.page, x.page_end,
                 x.title, x.embedding::extensions.vector(768)
          from jsonb_to_recordset(${tx.json(rows as postgres.JSONValue)}) as x(
            id text, ordinal int, start_char int, end_char int, text text, prefix text, heading_path text[],
            page int, page_end int, title text, embedding text)
          where exists (select 1 from captbot.documents d where d.user_id = ${userId} and d.id = ${docId} and not d.deleted)
          on conflict (user_id, doc_id, ordinal) do update set
            id = excluded.id, start_char = excluded.start_char, end_char = excluded.end_char, text = excluded.text,
            prefix = excluded.prefix, heading_path = excluded.heading_path, page = excluded.page, page_end = excluded.page_end,
            title = excluded.title, embedding = excluded.embedding`;
        if (!inserted.count) throw new HttpError(404, 'Document not found.');
        const [doc] = await tx`update captbot.documents d set
            progress = least(1, (select count(*) from captbot.chunks c where c.user_id = d.user_id and c.doc_id = d.id)::real / greatest(d.chunk_count, 1)),
            embedding_key = ${embeddingKey}
          where d.user_id = ${userId} and d.id = ${docId}
          returning progress`;
        return { stored: inserted.count, progress: doc.progress };
      });
    },

    async completeDocument(userId, docId, embeddingKey) {
      const [s] = await sql`select d.chunk_count,
          (select count(*) from captbot.chunks c where c.user_id = d.user_id and c.doc_id = d.id)::int as chunks,
          coalesce(char_length(t.text), 0)::int as text_length, coalesce(t.expected_length, 0) as expected_length
        from captbot.documents d left join captbot.doc_texts t on t.user_id = d.user_id and t.doc_id = d.id
        where d.user_id = ${userId} and d.id = ${docId} and not d.deleted`;
      if (!s) throw new HttpError(404, 'Document not found.');
      if (s.chunks < s.chunk_count) throw new HttpError(409, `${s.chunk_count - s.chunks} of ${s.chunk_count} chunks haven't arrived yet.`);
      if (s.text_length !== s.expected_length) throw new HttpError(409, "The document's text hasn't fully arrived yet.");
      await sql`update captbot.documents set status = 'ready', progress = 1, error = null, embedding_key = ${embeddingKey}, updated_at = ${Date.now()}
        where user_id = ${userId} and id = ${docId}`;
    },

    async documentState(userId, docId) {
      const [r] = await sql`select d.status, d.chunk_count,
          coalesce(char_length(t.text), 0)::int as text_length, coalesce(t.expected_length, 0) as expected_length, coalesce(t.parts, 0) as parts,
          coalesce((select array_agg(c.ordinal order by c.ordinal) from captbot.chunks c where c.user_id = d.user_id and c.doc_id = d.id), '{}') as ordinals
        from captbot.documents d left join captbot.doc_texts t on t.user_id = d.user_id and t.doc_id = d.id
        where d.user_id = ${userId} and d.id = ${docId} and not d.deleted`;
      if (!r) return { exists: false, textLength: 0, expectedLength: 0, parts: 0, chunkCount: 0, ordinals: [] };
      return {
        exists: true,
        status: r.status,
        textLength: r.text_length,
        expectedLength: r.expected_length,
        parts: r.parts,
        chunkCount: r.chunk_count,
        ordinals: r.ordinals,
      };
    },

    async documentText(userId, docId) {
      const [r] = await sql`select t.text, t.page_offsets from captbot.doc_texts t
        join captbot.documents d on d.user_id = t.user_id and d.id = t.doc_id and not d.deleted
        where t.user_id = ${userId} and t.doc_id = ${docId}`;
      return r ? { text: r.text, pageOffsets: r.page_offsets ?? undefined } : null;
    },

    async scope(userId, collectionIds) {
      const rows = await sql`select id, name from captbot.documents
        where user_id = ${userId} and not deleted and status = 'ready'
          and (cardinality(${collectionIds}::text[]) = 0 or collection_ids && ${collectionIds}::text[])`;
      return rows.map((r) => ({ id: r.id as string, name: r.name as string }));
    },

    async search(userId, { docIds, vector, tsquery, limit }) {
      if (!docIds.length || (!vector && !tsquery)) return [];
      const rows = await sql.begin(async (tx) => {
        // Filtered HNSW: keep scanning the graph until enough rows pass the user and scope filters.
        await tx`set local hnsw.iterative_scan = relaxed_order`;
        await tx`set local hnsw.ef_search = 100`;
        if (!vector) {
          return tx`with q as (select to_tsquery('english', ${tsquery}) as tq)
            select ${chunkColumns}, (1.0 / (60 + row_number() over (order by ts_rank_cd(c.tsv, q.tq, 32) desc)))::float8 as score
            from captbot.chunks c, q
            where c.user_id = ${userId} and c.doc_id = any(${docIds}::text[]) and c.tsv @@ q.tq
            order by ts_rank_cd(c.tsv, q.tq, 32) desc
            limit ${limit}`;
        }
        const v = `[${vector.join(',')}]`;
        // The query vector sits directly in ORDER BY (not in a CTE), which is what lets Postgres use the HNSW index.
        // Reciprocal rank fusion of the semantic and keyword rankings, as in the browser (k = 60).
        return tx`with q as (select case when ${tsquery} = '' then null else to_tsquery('english', ${tsquery}) end as tq),
          vec as (
            select id, row_number() over (order by dist) as rank
            from (
              select c.id, c.embedding <=> ${v}::extensions.vector(768) as dist
              from captbot.chunks c
              where c.user_id = ${userId} and c.doc_id = any(${docIds}::text[])
              order by c.embedding <=> ${v}::extensions.vector(768)
              limit ${limit}
            ) s
          ),
          kw as (
            select id, row_number() over (order by r desc) as rank
            from (
              select c.id, ts_rank_cd(c.tsv, q.tq, 32) as r
              from captbot.chunks c, q
              where q.tq is not null and c.user_id = ${userId} and c.doc_id = any(${docIds}::text[]) and c.tsv @@ q.tq
              order by r desc
              limit ${limit}
            ) s
          ),
          fused as (
            select id, sum(1.0 / (60 + rank))::float8 as score
            from (select id, rank from vec union all select id, rank from kw) u
            group by id
            order by score desc
            limit ${limit}
          )
          select ${chunkColumns}, f.score
          from fused f join captbot.chunks c on c.user_id = ${userId} and c.id = f.id
          order by f.score desc`;
      });
      return rows.map((r) => ({ chunk: toChunk(r), score: Number(r.score) }));
    },

    async neighbors(userId, positions) {
      if (!positions.length) return [];
      const rows = await sql`select ${chunkColumns}
        from captbot.chunks c
        join unnest(${positions.map((p) => p.docId)}::text[], ${positions.map((p) => p.ordinal)}::int[]) as n(doc_id, ordinal)
          on c.doc_id = n.doc_id and c.ordinal = n.ordinal
        where c.user_id = ${userId}`;
      return rows.map(toChunk);
    },

    async wipe(userId) {
      await sql.begin(async (tx) => {
        await tx`delete from captbot.chunks where user_id = ${userId}`;
        await tx`delete from captbot.doc_texts where user_id = ${userId}`;
        await tx`update captbot.documents set deleted = true, hash = '' where user_id = ${userId} and not deleted`;
        await tx`update captbot.messages set deleted = true, content = '', data = '{}' where user_id = ${userId} and not deleted`;
        await tx`update captbot.threads set deleted = true where user_id = ${userId} and not deleted`;
        await tx`update captbot.collections set deleted = true where user_id = ${userId} and not deleted`;
        await tx`update captbot.prompts set deleted = true where user_id = ${userId} and not deleted`;
      });
    },
  };
}
