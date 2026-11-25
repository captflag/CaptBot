-- Starred chats stay on top of the list on every device. Run this before deploying the API that reads it.
alter table captbot.threads add column if not exists starred boolean not null default false;
