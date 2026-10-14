-- Aikido review of pull request #10 (2026-10-14), content library.

-- 1. The sales handoff is email 3 only (the app already enforced it; now the database does too), for
--    the team's choice and Claude's pick alike.
alter table public.content_sequences add constraint content_sequences_handoff_email3 check (not handoff or slot = 3);
alter table public.content_sequences add constraint content_sequences_suggested_handoff_email3 check (not coalesce(suggested_handoff, false) or slot = 3);

-- 2. Approval state is the server's. Team members may only move a sequence between "awaiting
--    approval" and "not required" while it isn't approved, and reopen an approved one (approved →
--    pending with reapproval set, which is what editing an approved sequence does through
--    content_sequence_needs_reapproval). They can't take an approved sequence to "not required" or
--    clear "changed since approval" by hand. Everything else stays as before.
create or replace function public.guard_content_piece_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.seq_status = 'approved' or new.reapproval or new.approved_at is not null or new.approved_by_profile_id is not null or new.approval_round <> 0
       or new.notion_page_id is not null or new.notion_page_url is not null or new.notion_briefed_at is not null then
      raise exception 'Sequences are approved by the app only';
    end if;
    if new.archived_at is not null or new.imported_from is not null then raise exception 'Set by the app only'; end if;
    return new;
  end if;
  if new.seq_status = 'approved' and old.seq_status is distinct from 'approved' then
    raise exception 'Sequences are approved by the app only';
  end if;
  if old.seq_status = 'approved' and new.seq_status is distinct from 'approved' and not (new.seq_status = 'pending' and new.reapproval) then
    raise exception 'An approved sequence can only be reopened by changing it';
  end if;
  if new.reapproval is distinct from old.reapproval and not (new.reapproval and old.seq_status = 'approved' and new.seq_status = 'pending') then
    raise exception '"Changed since approval" is set by the app only';
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
revoke execute on function public.guard_content_piece_fields() from public, anon, authenticated;
