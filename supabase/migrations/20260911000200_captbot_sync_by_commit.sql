-- Sync ordering by commit instead of by clock.
--
-- Each synced row records the transaction that last wrote it. A pull only returns rows from
-- transactions older than the oldest one still running, and pages through them in transaction
-- order, so a slow transaction can never commit "behind" a device's cursor and be skipped.

do $$
declare
  t text;
begin
  foreach t in array array['collections', 'documents', 'threads', 'messages', 'prompts'] loop
    execute format('alter table captbot.%I add column txid xid8 not null default pg_current_xact_id()', t);
    execute format('create index %I on captbot.%I (user_id, txid, id)', t || '_txid', t);
    execute format('drop index if exists captbot.%I', t || '_synced');
  end loop;
end
$$;

create or replace function captbot.touch() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.synced_at := clock_timestamp();
  new.txid := pg_current_xact_id();
  return new;
end
$$;
