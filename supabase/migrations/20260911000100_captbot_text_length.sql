-- The full length (in code points) a document's text will reach once every part has arrived,
-- so the server can tell a complete upload from an interrupted one.
alter table captbot.doc_texts add column expected_length integer not null default 0;
