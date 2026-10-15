-- 20261015000060 replaced client_data_stamp, which dropped the search_path set by 20260929000034
-- (Supabase advisor: function_search_path_mutable). Same setting as there.
alter function public.client_data_stamp(uuid) set search_path = public, pg_temp;
