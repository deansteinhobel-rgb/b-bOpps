-- The news cellar's suggested questions: answers are kept for 7 days and shared by everyone, so
-- a second click (or a second person) doesn't pay for the same answer (Dean). Public news only,
-- no client data, so this table isn't client-scoped. Written and read by the server (secret key)
-- only: RLS on with no policies means signed-in users can't touch it directly.
create table public.news_answers (
  question text primary key,
  answer text not null,
  sources jsonb not null default '[]',
  model text,
  usage jsonb,
  created_at timestamptz not null default now()
);
alter table public.news_answers enable row level security;
