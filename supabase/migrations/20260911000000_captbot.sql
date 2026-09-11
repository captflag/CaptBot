-- CaptBot: knowledge base, vectors and chats, kept separate for every Clerk user.
--
-- Everything lives in its own schema, which the Supabase Data API does not expose.
-- Only the CaptBot API (connecting through the pooler as the database owner) reads
-- or writes it, and every query it runs is scoped by user_id. RLS is still enabled
-- on every table, so a mistaken grant can't open the data to anon or authenticated.

create extension if not exists vector with schema extensions;

create schema if not exists captbot;
revoke all on schema captbot from public;
revoke all on schema captbot from anon, authenticated;

-- Rows the browser syncs carry synced_at, bumped on every write, so a device can
-- ask for "everything that changed since my last pull". Deletes are tombstones.
create or replace function captbot.touch() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end
$$;

create table captbot.collections (
  user_id    text not null,
  id         text not null,
  name       text not null,
  color      text not null,
  created_at bigint not null,
  deleted    boolean not null default false,
  synced_at  timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create table captbot.documents (
  user_id        text not null,
  id             text not null,
  name           text not null,
  source_type    text not null,
  mime_type      text not null default '',
  url            text,
  hash           text not null default '',
  collection_ids text[] not null default '{}',
  char_count     integer not null default 0,
  chunk_count    integer not null default 0,
  page_count     integer,
  status         text not null default 'queued',
  progress       real not null default 0,
  error          text,
  embedding_key  text,
  created_at     bigint not null,
  updated_at     bigint not null,
  deleted        boolean not null default false,
  synced_at      timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);
create index documents_hash on captbot.documents (user_id, hash) where not deleted;

-- Full extracted text, for the source viewer. Uploaded in parts to stay under request limits.
create table captbot.doc_texts (
  user_id      text not null,
  doc_id       text not null,
  text         text not null default '',
  parts        integer not null default 0,
  page_offsets integer[],
  primary key (user_id, doc_id),
  foreign key (user_id, doc_id) references captbot.documents (user_id, id) on delete cascade
);

create table captbot.chunks (
  user_id      text not null,
  id           text not null,
  doc_id       text not null,
  ordinal      integer not null,
  start_char   integer not null,
  end_char     integer not null,
  text         text not null,
  -- Repeated context a continuation chunk needs, such as a table's header rows.
  prefix       text,
  heading_path text[] not null default '{}',
  page         integer,
  page_end     integer,
  -- "document › section", matched with a lower weight than the body.
  title        text not null default '',
  embedding    extensions.vector(768) not null,
  tsv          tsvector generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(prefix, '') || ' ' || text), 'A') ||
    setweight(to_tsvector('english'::regconfig, title), 'B')
  ) stored,
  primary key (user_id, id),
  unique (user_id, doc_id, ordinal),
  foreign key (user_id, doc_id) references captbot.documents (user_id, id) on delete cascade
);
create index chunks_embedding on captbot.chunks using hnsw (embedding extensions.vector_cosine_ops);
create index chunks_tsv on captbot.chunks using gin (tsv);

create table captbot.threads (
  user_id        text not null,
  id             text not null,
  title          text not null,
  collection_ids text[] not null default '{}',
  created_at     bigint not null,
  updated_at     bigint not null,
  deleted        boolean not null default false,
  synced_at      timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create table captbot.messages (
  user_id    text not null,
  id         text not null,
  thread_id  text not null,
  role       text not null,
  content    text not null default '',
  created_at bigint not null,
  -- Everything else on a message: sources, trace, steps, flags. Image data is not stored.
  data       jsonb not null default '{}',
  deleted    boolean not null default false,
  synced_at  timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);
create index messages_thread on captbot.messages (user_id, thread_id);

create table captbot.prompts (
  user_id    text not null,
  id         text not null,
  text       text not null,
  created_at bigint not null,
  deleted    boolean not null default false,
  synced_at  timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

do $$
declare
  t text;
begin
  foreach t in array array['collections', 'documents', 'threads', 'messages', 'prompts'] loop
    execute format('create index %I on captbot.%I (user_id, synced_at)', t || '_synced', t);
    execute format('create trigger touch before update on captbot.%I for each row execute function captbot.touch()', t);
  end loop;
  foreach t in array array['collections', 'documents', 'doc_texts', 'chunks', 'threads', 'messages', 'prompts'] loop
    execute format('alter table captbot.%I enable row level security', t);
  end loop;
end
$$;
