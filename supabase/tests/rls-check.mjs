// Applies every migration to an in-memory Postgres (PGlite) with stand-ins for Supabase auth,
// then checks sign-up rules and RLS as different users. Never touches the real Supabase project.
//   pnpm test:db
import { PGlite } from "@electric-sql/pglite"
import fs from "node:fs"
const db = new PGlite()
// Minimal stand-ins for Supabase's auth schema and roles
await db.exec(`
  create role authenticated; create role anon;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
`)
const dir = new URL("../migrations/", import.meta.url)
const sql = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => fs.readFileSync(new URL(f, dir), "utf8")).join("\n")
await db.exec(sql)
console.log("migration applied OK")
const q = async (s, p) => (await db.query(s, p)).rows
// seed invites and a client
await db.exec(`
  insert into public.team_invites (email, full_name, role) values
    ('dean.steinhobel@bordeauxandburgundy.co.uk','Dean Steinhobel','admin'),
    ('andrea.restrepo@bordeauxandburgundy.co.uk','Andrea Restrepo','specialist'),
    ('danny.thompson@bordeauxandburgundy.co.uk','Danny Thompson','am');
  insert into public.clients (id, name, slug, notion_client_option) values
    ('11111111-1111-1111-1111-111111111111','Camber','camber','Camber'),
    ('22222222-2222-2222-2222-222222222222','DNSFilter','dnsfilter','DNSFilter');
  insert into public.client_team_invites values
    ('11111111-1111-1111-1111-111111111111','andrea.restrepo@bordeauxandburgundy.co.uk','specialist'),
    ('22222222-2222-2222-2222-222222222222','danny.thompson@bordeauxandburgundy.co.uk','am');
  insert into auth.users values
    ('aaaaaaaa-0000-0000-0000-000000000001','Dean.Steinhobel@bordeauxandburgundy.co.uk'),
    ('aaaaaaaa-0000-0000-0000-000000000002','andrea.restrepo@bordeauxandburgundy.co.uk'),
    ('aaaaaaaa-0000-0000-0000-000000000003','danny.thompson@bordeauxandburgundy.co.uk'),
    ('aaaaaaaa-0000-0000-0000-000000000004','someone.new@bordeauxandburgundy.co.uk');
`)
console.log("profiles:", await q("select email, role from public.profiles order by email"))
console.log("client_team:", await q("select c.slug, p.email, t.role from public.client_team t join public.clients c on c.id=t.client_id join public.profiles p on p.id=t.profile_id"))
try { await db.exec(`insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000009','hacker@gmail.com')`); console.log("FAIL: outside domain allowed") } catch (e) { console.log("outside domain blocked:", e.message) }

// RLS as each user
await db.exec(`grant usage on schema public to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated;`)
async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.uid', '${uid}', false);`)
  try { return await fn() } finally { await db.exec(`reset role`) }
}
for (const [who, uid] of [["dean(admin)","aaaaaaaa-0000-0000-0000-000000000001"],["andrea(camber)","aaaaaaaa-0000-0000-0000-000000000002"],["danny(dnsf)","aaaaaaaa-0000-0000-0000-000000000003"],["new(no role)","aaaaaaaa-0000-0000-0000-000000000004"]]) {
  const rows = await as(uid, () => q("select slug from public.clients order by slug"))
  console.log(`${who} sees clients:`, rows.map(r => r.slug))
}
// Andrea tries to delete a client and update another client's data
const del = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("delete from public.clients returning slug"))
console.log("andrea delete clients -> rows deleted:", del.length)
const delAdmin = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("delete from public.clients returning slug"))
console.log("dean(admin) delete clients -> rows deleted:", delAdmin.length)
const upd = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("update public.clients set name='x' returning slug"))
console.log("andrea update clients -> rows updated:", upd.length)
// check runs/results scoping
await db.exec(`insert into public.check_definitions (key,name,cadence,owner_role,instructions) values ('budget_pacing','Budget pacing','weekly','specialist','x')`)
const run = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("insert into public.check_runs (client_id,cadence,period_start,period_end) values ('11111111-1111-1111-1111-111111111111','weekly','2026-09-28','2026-10-04') returning id"))
console.log("andrea creates camber run:", run.length === 1)
try { await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("insert into public.check_runs (client_id,cadence,period_start,period_end) values ('22222222-2222-2222-2222-222222222222','weekly','2026-09-28','2026-10-04')")); console.log("FAIL: andrea created dnsf run") } catch (e) { console.log("andrea dnsf run blocked:", e.message.slice(0,60)) }
try { await db.exec(`insert into public.check_results (check_run_id, client_id, check_definition_id) select '${run[0].id}', '22222222-2222-2222-2222-222222222222', id from public.check_definitions`); console.log("FAIL: mismatched client") } catch (e) { console.log("mismatched result client blocked:", e.message) }
const defs = await as("aaaaaaaa-0000-0000-0000-000000000004", () => q("select key from public.check_definitions"))
console.log("no-role user sees definitions:", defs.length)

// Soft removal (removed_at) takes away access without deleting anything.
await db.exec(`update public.client_team set removed_at = now() where profile_id = 'aaaaaaaa-0000-0000-0000-000000000002'`)
const afterRemoval = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("select slug from public.clients"))
console.log(afterRemoval.length === 0 ? "removed member loses access: OK" : "FAIL: removed member still sees clients")
const stillThere = await q("select count(*)::int as n from public.client_team where profile_id = 'aaaaaaaa-0000-0000-0000-000000000002'")
console.log(stillThere[0].n === 1 ? "removed row kept for history: OK" : "FAIL: row missing")

// Sprints: team members work on their own client's sprints only; nothing can be deleted.
await db.exec(`update public.client_team set removed_at = null`)
const sp = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("insert into public.sprints (client_id, number, start_date, end_date) values ('11111111-1111-1111-1111-111111111111', 1, '2026-09-28', '2026-10-11') returning id"))
console.log(sp.length === 1 ? "andrea creates camber sprint: OK" : "FAIL: sprint not created")
try { await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("insert into public.sprints (client_id, number, start_date, end_date) values ('22222222-2222-2222-2222-222222222222', 1, '2026-09-28', '2026-10-11')")); console.log("FAIL: andrea created dnsfilter sprint") } catch { console.log("andrea blocked from dnsfilter sprint: OK") }
try { await db.exec(`insert into public.sprint_items (sprint_id, client_id, kind, text) values ('${sp[0].id}', '22222222-2222-2222-2222-222222222222', 'learning', 'x')`); console.log("FAIL: mismatched sprint item") } catch { console.log("sprint item client guard: OK") }
const delSprint = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("delete from public.sprints returning id"))
console.log(delSprint.length === 0 ? "sprints can't be deleted, even by admin: OK" : "FAIL: sprint deleted")
