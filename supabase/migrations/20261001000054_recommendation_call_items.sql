-- Pour a Sprint suggestions that follow up something said on a client call (Dean, 2026-10-01):
-- Claude names the call item, and approving the suggestion links the planned test to it (the pink
-- "From a call" tag) and closes the reminder. Additive.
alter table public.sprint_recommendations
  add column call_commitment_id uuid references public.call_commitments (id);
