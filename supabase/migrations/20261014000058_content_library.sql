-- Content library (Dean, 2026-10-14; Camber first): every live landing page and guide a client has,
-- and the three emails to send someone who engaged with each one. Moved in from the "Camber content
-- library" artifact. Plan › Content library. Client-scoped like everything else; nothing is deleted
-- ("Remove from library" archives).

-- One row per piece of content. The code (C01, C02 ...) is the library's own short id, kept from the
-- artifact so the team's references still work.
create table public.content_pieces (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  code text not null check (code ~ '^C[0-9]{2,4}$'),
  title text not null check (length(trim(title)) between 1 and 300),
  url text check (url is null or url ~ '^https://'),
  type text not null,                      -- Landing page, Guide, Tool ... (per-client list in the app)
  theme text,
  stage text not null default 'Awareness' check (stage in ('Awareness', 'Consideration', 'Decision')),
  audiences text[] not null default '{}',  -- who it's written for (Camber: Enterprise, SMB, PE)
  verticals text[] not null default '{}',  -- every vertical = relevant to all of them
  purpose text,
  -- Approval of its follow-up sequence. "approved" is set by the server once the Notion brief is
  -- created (or logged as a dry run); a change to an approved sequence sends it back to pending with
  -- reapproval = true.
  seq_status text not null default 'pending' check (seq_status in ('pending', 'approved', 'not_required')),
  reapproval boolean not null default false,
  approved_at timestamptz,
  approved_by_profile_id uuid references public.profiles (id),
  approval_round int not null default 0,   -- +1 on every approval; part of the Notion brief's key
  notion_page_id text,                     -- the latest sequence brief in Master Production
  notion_page_url text,
  notion_briefed_at timestamptz,
  imported_from text,                      -- e.g. 'artifact:3jtNeys7LKXHmepmH3WJt8' for the first load
  created_by_profile_id uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by_profile_id uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by_profile_id uuid references public.profiles (id),
  unique (client_id, code)
);
create index content_pieces_client_idx on public.content_pieces (client_id) where archived_at is null;
create trigger content_pieces_updated_at before update on public.content_pieces
  for each row execute function public.set_updated_at();

-- A piece's follow-up sequence: one row per email (slot 1-3). Each email sends another piece, or
-- the sales handoff, with an "angle" (the one-line hook a copywriter turns into the email). Claude's
-- pick is kept beside the team's choice so "Revert to Claude's pick" works and we can see how often
-- the team overrides it.
create table public.content_sequences (
  piece_id uuid not null references public.content_pieces (id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  client_id uuid not null references public.clients (id) on delete cascade,
  target_piece_id uuid references public.content_pieces (id),
  handoff boolean not null default false,  -- the email is the sales handoff, not a piece
  angle text check (angle is null or length(angle) <= 300),
  suggested_target_piece_id uuid references public.content_pieces (id),
  suggested_handoff boolean,
  suggested_angle text check (suggested_angle is null or length(suggested_angle) <= 300),
  suggested_at timestamptz,
  updated_by_profile_id uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (piece_id, slot),
  check (not (handoff and target_piece_id is not null)),
  check (target_piece_id is distinct from piece_id),
  check (not (coalesce(suggested_handoff, false) and suggested_target_piece_id is not null))
);
create index content_sequences_client_idx on public.content_sequences (client_id);
create index content_sequences_target_idx on public.content_sequences (target_piece_id) where target_piece_id is not null;
create trigger content_sequences_updated_at before update on public.content_sequences
  for each row execute function public.set_updated_at();

-- A sequence belongs to its piece's client, and only ever sends that client's pieces. Security
-- definer so an archived target (hidden by RLS) is still found.
create function public.content_sequence_client_matches() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.client_id is distinct from (select client_id from public.content_pieces where id = new.piece_id) then
    raise exception 'client_id must match the piece';
  end if;
  if new.target_piece_id is not null and new.client_id is distinct from (select client_id from public.content_pieces where id = new.target_piece_id) then
    raise exception 'A sequence can only send the same client''s content';
  end if;
  if new.suggested_target_piece_id is not null and new.client_id is distinct from (select client_id from public.content_pieces where id = new.suggested_target_piece_id) then
    raise exception 'A sequence can only send the same client''s content';
  end if;
  return new;
end $$;
create trigger content_sequences_client_guard before insert or update on public.content_sequences
  for each row execute function public.content_sequence_client_matches();

-- Approval, the Notion brief and archiving are kept for the server (and archiving for admins / GTM
-- leads, as with sprint tests); a piece's code, client and author never change. Claude's pick is
-- written by the server only, so nobody can label their own choice as Claude's.
create function public.guard_content_piece_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.seq_status = 'approved' or new.approved_at is not null or new.approved_by_profile_id is not null or new.approval_round <> 0
       or new.notion_page_id is not null or new.notion_page_url is not null or new.notion_briefed_at is not null then
      raise exception 'Sequences are approved by the app only';
    end if;
    if new.archived_at is not null or new.imported_from is not null then raise exception 'Set by the app only'; end if;
    return new;
  end if;
  if new.seq_status = 'approved' and old.seq_status is distinct from 'approved' then
    raise exception 'Sequences are approved by the app only';
  end if;
  if (new.approved_at, new.approved_by_profile_id, new.approval_round, new.notion_page_id, new.notion_page_url, new.notion_briefed_at)
     is distinct from (old.approved_at, old.approved_by_profile_id, old.approval_round, old.notion_page_id, old.notion_page_url, old.notion_briefed_at) then
    raise exception 'The approval and Notion brief are set by the app only';
  end if;
  if (new.archived_at, new.archived_by_profile_id) is distinct from (old.archived_at, old.archived_by_profile_id) and not public.is_admin() then
    raise exception 'Only admins and GTM leads can remove content from the library';
  end if;
  if (new.client_id, new.code, new.imported_from, new.created_by_profile_id, new.created_at)
     is distinct from (old.client_id, old.code, old.imported_from, old.created_by_profile_id, old.created_at) then
    raise exception 'A piece''s code, client and author can''t be changed';
  end if;
  return new;
end $$;
create trigger content_pieces_guard before insert or update on public.content_pieces
  for each row execute function public.guard_content_piece_fields();

create function public.guard_content_sequence_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.suggested_target_piece_id is not null or new.suggested_handoff is not null or new.suggested_angle is not null or new.suggested_at is not null then
      raise exception 'Claude''s pick is set by the app only';
    end if;
    return new;
  end if;
  if (new.suggested_target_piece_id, new.suggested_handoff, new.suggested_angle, new.suggested_at)
     is distinct from (old.suggested_target_piece_id, old.suggested_handoff, old.suggested_angle, old.suggested_at) then
    raise exception 'Claude''s pick is set by the app only';
  end if;
  if (new.piece_id, new.slot, new.client_id) is distinct from (old.piece_id, old.slot, old.client_id) then
    raise exception 'A sequence email can''t be moved';
  end if;
  return new;
end $$;
create trigger content_sequences_guard before insert or update on public.content_sequences
  for each row execute function public.guard_content_sequence_fields();

-- Changing an approved sequence (what an email sends, or its angle) sends it back for approval, so
-- the Notion brief is never out of date without anyone noticing.
create function public.content_sequence_needs_reapproval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.target_piece_id, new.handoff, new.angle) is distinct from (old.target_piece_id, old.handoff, old.angle) then
    update public.content_pieces set seq_status = 'pending', reapproval = true
    where id = new.piece_id and seq_status = 'approved';
  end if;
  return new;
end $$;
create trigger content_sequences_reapproval after update on public.content_sequences
  for each row execute function public.content_sequence_needs_reapproval();

revoke execute on function public.content_sequence_client_matches(), public.guard_content_piece_fields(),
  public.guard_content_sequence_fields(), public.content_sequence_needs_reapproval() from public, anon, authenticated;

-- RLS: the client's team (and admins, GTM leads, viewers) read; the team edits (not viewers);
-- archived pieces are hidden. No DELETE policies.
alter table public.content_pieces enable row level security;
alter table public.content_sequences enable row level security;
create policy "content pieces: read assigned" on public.content_pieces for select to authenticated
  using (public.can_access_client(client_id) and archived_at is null);
create policy "content pieces: team adds" on public.content_pieces for insert to authenticated
  with check (public.can_edit_client(client_id));
create policy "content pieces: team edits" on public.content_pieces for update to authenticated
  using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));
create policy "content sequences: read assigned" on public.content_sequences for select to authenticated
  using (public.can_access_client(client_id));
create policy "content sequences: team adds" on public.content_sequences for insert to authenticated
  with check (public.can_edit_client(client_id));
create policy "content sequences: team edits" on public.content_sequences for update to authenticated
  using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));

-- Notion: a third kind of Master Production page, the email sequence brief (Production Type "Email",
-- Status Content "Ready for Copy"). Still create-only through createNotionAction. brief_key makes each
-- one idempotent: 'sequence:<piece id>:<approval round>' for a piece's own sequence, 'slotted:<piece
-- id>' for the "Email sequence updates" brief when a new piece is added to existing sequences.
alter table public.notion_write_log drop constraint notion_write_log_operation_check;
alter table public.notion_write_log add constraint notion_write_log_operation_check
  check (operation in ('create_action', 'create_test_brief', 'create_comment', 'create_sequence_brief'));
alter table public.notion_write_log add column content_piece_id uuid references public.content_pieces (id);
alter table public.notion_write_log add column brief_key text;
alter table public.notion_write_log add constraint notion_write_log_sequence_brief_keyed
  check (operation <> 'create_sequence_brief' or (content_piece_id is not null and brief_key is not null));
create unique index notion_write_log_one_sequence_brief on public.notion_write_log (brief_key)
  where operation = 'create_sequence_brief' and not dry_run and success is not false;
