// Applies every migration to an in-memory Postgres (PGlite) with stand-ins for Supabase auth,
// then checks sign-up rules and RLS as different users. Never touches the real Supabase project.
//   pnpm test:db
import { PGlite } from "@electric-sql/pglite"
import fs from "node:fs"
// Every check prints "...: OK" or "FAIL: ...". Count the FAILs so the run (and CI) fails on any of them.
let failures = 0
const log = console.log
console.log = (...args) => {
  if (typeof args[0] === "string" && args[0].startsWith("FAIL")) failures++
  log(...args)
}
process.on("exit", (code) => {
  if (code !== 0) return
  if (failures) {
    log(`\n${failures} RLS check${failures === 1 ? "" : "s"} failed.`)
    process.exit(1)
  } else log("\nAll RLS checks passed.")
})
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
  -- Supabase Cron: PGlite has no pg_cron or pg_net, so scheduling a job only records it
  create schema extensions;
  create schema cron;
  create table cron.job (jobname text primary key, schedule text, command text);
  create function cron.schedule(jobname text, schedule text, command text) returns bigint language sql as $$ insert into cron.job values (jobname, schedule, command) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command; select 1::bigint $$;
`)
const dir = new URL("../migrations/", import.meta.url)
const sql = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => fs.readFileSync(new URL(f, dir), "utf8")).join("\n")
  // pg_cron and pg_net aren't in PGlite; the stand-ins above cover what the migrations call
  .replace(/^create extension if not exists (pg_cron|pg_net)\b.*$/gm, "")
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
await db.exec(`grant usage on schema public to authenticated; grant usage on schema auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated;`)
async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.uid', '${uid}', false);`)
  // Back to the server's view afterwards: no role and no auth.uid(), like the secret key.
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.uid', '', false);`) }
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

// Sprint tests: team-scoped, client guard, no deletes.
const t1 = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`insert into public.sprint_tests (sprint_id, client_id, title) values ('${sp[0].id}', '11111111-1111-1111-1111-111111111111', 'Test') returning id`))
console.log(t1.length === 1 ? "andrea plans a camber test: OK" : "FAIL: test not created")
const danny = await as("aaaaaaaa-0000-0000-0000-000000000003", () => q("select id from public.sprint_tests"))
console.log(danny.length === 0 ? "danny (dnsfilter) can't see camber tests: OK" : "FAIL: cross-client test visible")
const delTest = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("delete from public.sprint_tests returning id"))
console.log(delTest.length === 0 ? "tests can't be deleted: OK" : "FAIL: test deleted")

// Columns kept for admins and the server (security audit 2026-10, M5): the team update policies
// cover every column, so guard triggers refuse the rest.
{
  const andrea = "aaaaaaaa-0000-0000-0000-000000000002", dean = "aaaaaaaa-0000-0000-0000-000000000001"
  const refused = async (what, sql) => {
    try { await as(andrea, () => q(sql)); console.log(`FAIL: team member could ${what}`) } catch { console.log(`team member can't ${what}: OK`) }
  }
  const test = `where id = '${t1[0].id}'`
  await refused("archive a test", `update public.sprint_tests set archived_at = now() ${test}`)
  await refused("rename a test", `update public.sprint_tests set title = 'Renamed' ${test}`)
  await refused("set a test's Notion brief", `update public.sprint_tests set notion_page_id = 'abc' ${test}`)
  await refused("change who created a test", `update public.sprint_tests set created_by_profile_id = '${dean}' ${test}`)
  await refused("plan an archived test", `insert into public.sprint_tests (sprint_id, client_id, title, archived_at) values ('${sp[0].id}', '11111111-1111-1111-1111-111111111111', 'Hidden', now())`)
  const teamEdit = await as(andrea, () => q(`update public.sprint_tests set status = 'ready', findings_notes = 'x', owner_name = 'Andrea' ${test} returning id`))
  console.log(teamEdit.length === 1 ? "team member still moves a test on and writes findings: OK" : "FAIL: team edit refused")
  const adminRename = await as(dean, () => q(`update public.sprint_tests set title = 'Test' ${test} returning id`))
  console.log(adminRename.length === 1 ? "admin renames a test: OK" : "FAIL: admin rename refused")

  const res = await q(`insert into public.check_results (check_run_id, client_id, check_definition_id) select '${run[0].id}', '11111111-1111-1111-1111-111111111111', id from public.check_definitions returning id`)
  const result = `where id = '${res[0].id}'`
  await refused("overwrite a check's numbers", `update public.check_results set auto_data = '{"x":1}' ${result}`)
  await refused("mark a red as actioned", `update public.check_results set notion_action_page_id = 'abc' ${result}`)
  const saved = await as(andrea, () => q(`update public.check_results set findings = 'Overspend', checked_at = now() ${result} returning id`))
  console.log(saved.length === 1 ? "team member still saves a check: OK" : "FAIL: check save refused")
  const server = await q(`update public.check_results set auto_data = '{"x":1}', notion_action_page_id = 'abc' ${result} returning id`)
  console.log(server.length === 1 ? "the server writes check numbers and Notion links: OK" : "FAIL: server write refused")

  const sprint = `where id = '${sp[0].id}'`
  const closed = await as(andrea, () => q(`update public.sprints set closed_at = now() ${sprint} returning id`))
  console.log(closed.length === 1 ? "team member closes a sprint: OK" : "FAIL: close refused")
  await refused("reopen a sprint", `update public.sprints set closed_at = null ${sprint}`)
  await refused("change a sprint's dates", `update public.sprints set number = 7 ${sprint}`)
  const reopened = await as(dean, () => q(`update public.sprints set closed_at = null ${sprint} returning id`))
  console.log(reopened.length === 1 ? "admin reopens a sprint: OK" : "FAIL: admin reopen refused")
}

// Claude's sprint suggestions: the team reads, only GTM leads / admins create and decide, no deletes.
try { await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`insert into public.sprint_ai_runs (client_id, sprint_id) values ('11111111-1111-1111-1111-111111111111', '${sp[0].id}')`)); console.log("FAIL: specialist started a run") } catch { console.log("specialist can't start a sprint run: OK") }
const aiRun = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q(`insert into public.sprint_ai_runs (client_id, sprint_id) values ('11111111-1111-1111-1111-111111111111', '${sp[0].id}') returning id`))
console.log(aiRun.length === 1 ? "admin starts a sprint run: OK" : "FAIL: admin run not created")
await db.exec(`insert into public.sprint_recommendations (run_id, client_id, sprint_id, platform, title) values ('${aiRun[0].id}', '11111111-1111-1111-1111-111111111111', '${sp[0].id}', 'reddit', 'Try Reddit conversation ads')`)
const seen = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("select id from public.sprint_recommendations"))
console.log(seen.length === 1 ? "andrea reads camber suggestions: OK" : "FAIL: andrea can't read suggestions")
const unseen = await as("aaaaaaaa-0000-0000-0000-000000000003", () => q("select id from public.sprint_recommendations"))
console.log(unseen.length === 0 ? "danny (dnsfilter) can't see camber suggestions: OK" : "FAIL: cross-client suggestion visible")
const andreaApproves = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("update public.sprint_recommendations set status = 'approved' returning id"))
console.log(andreaApproves.length === 0 ? "specialist can't approve: OK" : "FAIL: specialist approved")
const deanApproves = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("update public.sprint_recommendations set status = 'approved' returning id"))
console.log(deanApproves.length === 1 ? "admin approves: OK" : "FAIL: admin couldn't approve")
const delRec = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("delete from public.sprint_recommendations returning id"))
console.log(delRec.length === 0 ? "suggestions can't be deleted: OK" : "FAIL: suggestion deleted")

// Insight actions: the client's team logs what it did with an insight; append-only (no updates, no deletes).
const ia = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`insert into public.insight_actions (client_id, insight_key, rule, action, items) values ('11111111-1111-1111-1111-111111111111', 'negatives:google_ads:1', 'negatives', 'done', '{foo}') returning id, profile_id`))
console.log(ia.length === 1 && ia[0].profile_id === "aaaaaaaa-0000-0000-0000-000000000002" ? "andrea logs a camber insight action: OK" : "FAIL: insight action not logged")
try { await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`insert into public.insight_actions (client_id, insight_key, rule, action) values ('22222222-2222-2222-2222-222222222222', 'x', 'x', 'done')`)); console.log("FAIL: andrea logged a dnsfilter insight") } catch { console.log("andrea blocked from dnsfilter insights: OK") }
try { await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`insert into public.insight_actions (client_id, insight_key, rule, action, profile_id) values ('11111111-1111-1111-1111-111111111111', 'x', 'x', 'done', 'aaaaaaaa-0000-0000-0000-000000000001')`)); console.log("FAIL: logged as someone else") } catch { console.log("can't log as someone else: OK") }
const iaDanny = await as("aaaaaaaa-0000-0000-0000-000000000003", () => q("select id from public.insight_actions"))
console.log(iaDanny.length === 0 ? "danny (dnsfilter) can't see camber insight actions: OK" : "FAIL: cross-client insight action visible")
const iaUpd = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("update public.insight_actions set action = 'dismissed' returning id"))
const iaDel = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("delete from public.insight_actions returning id"))
console.log(iaUpd.length === 0 && iaDel.length === 0 ? "insight actions are append-only, even for admin: OK" : "FAIL: insight action changed")

// Profiles: people edit their own details, never their role; admins can. Last seen is throttled.
const ownEdit = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("update public.profiles set job_title = 'Specialist', bio = 'Hi' where id = 'aaaaaaaa-0000-0000-0000-000000000002' returning id"))
console.log(ownEdit.length === 1 ? "andrea edits her own profile: OK" : "FAIL: own profile not editable")
const otherEdit = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("update public.profiles set job_title = 'x' where id = 'aaaaaaaa-0000-0000-0000-000000000003' returning id"))
console.log(otherEdit.length === 0 ? "andrea can't edit danny's profile: OK" : "FAIL: edited someone else")
try { await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("update public.profiles set role = 'admin' where id = 'aaaaaaaa-0000-0000-0000-000000000002'")); console.log("FAIL: self-promoted to admin") } catch { console.log("can't change own role: OK") }
const adminRole = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("update public.profiles set role = 'specialist' where id = 'aaaaaaaa-0000-0000-0000-000000000002' returning id"))
console.log(adminRole.length === 1 ? "admin changes a role: OK" : "FAIL: admin couldn't change role")
await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("select public.touch_last_seen()"))
const lastSeen = await q("select last_seen_at from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000002'")
console.log(lastSeen[0].last_seen_at ? "last seen recorded: OK" : "FAIL: last seen not recorded")

// Feedback: own or admin reads, anyone with a role sends, admins triage, no deletes.
const fb = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("insert into public.feedback (kind, title) values ('bug', 'Broken button') returning id"))
console.log(fb.length === 1 ? "andrea reports a bug: OK" : "FAIL: feedback not sent")
const fbDanny = await as("aaaaaaaa-0000-0000-0000-000000000003", () => q("select id from public.feedback"))
console.log(fbDanny.length === 0 ? "danny can't read andrea's feedback: OK" : "FAIL: feedback visible to others")
const fbAndreaTriage = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("update public.feedback set status = 'done' returning id"))
const fbAdmin = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("update public.feedback set status = 'planned' returning id"))
console.log(fbAndreaTriage.length === 0 && fbAdmin.length === 1 ? "only admins triage feedback: OK" : "FAIL: feedback triage")
const fbDel = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("delete from public.feedback returning id"))
console.log(fbDel.length === 0 ? "feedback can't be deleted: OK" : "FAIL: feedback deleted")

// Rate limits: per person and kind, capped; nobody signed in gets nothing; the events table is closed.
const take = () => as("aaaaaaaa-0000-0000-0000-000000000002", () => q("select public.take_rate_limit('test', 2, 3600) as ok"))
const r1 = await take(), r2 = await take(), r3 = await take()
console.log(r1[0].ok && r2[0].ok && !r3[0].ok ? "rate limit allows 2 then blocks: OK" : "FAIL: rate limit")
const other = await as("aaaaaaaa-0000-0000-0000-000000000003", () => q("select public.take_rate_limit('test', 2, 3600) as ok"))
console.log(other[0].ok ? "limits are per person: OK" : "FAIL: limit shared between people")
const anon = await as("", () => q("select public.take_rate_limit('test', 2, 3600) as ok"))
console.log(!anon[0].ok ? "no session, no quota: OK" : "FAIL: anonymous quota")
const peek = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("select id from public.rate_limit_events"))
console.log(peek.length === 0 ? "rate limit events are private: OK" : "FAIL: events readable")

// Advisor fixes: nothing in public is callable without signing in.
await db.exec(`set role anon`)
let anonBlocked = 0
for (const fn of ["public.is_admin()", "public.has_role()", "public.touch_last_seen()", "public.take_rate_limit('x', 1, 60)"]) {
  try { await db.query(`select ${fn}`) } catch { anonBlocked++ }
}
await db.exec(`reset role`)
console.log(anonBlocked === 4 ? "signed-out visitors can't call privileged functions: OK" : `FAIL: anon could call ${4 - anonBlocked} functions`)

// Viewers (everyone in B&B's Notion workspace): read every client, change nothing.
await db.exec(`
  insert into public.team_invites (email, full_name, role) values ('vera.viewer@bordeauxandburgundy.co.uk','Vera Viewer','viewer');
  insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000010','vera.viewer@bordeauxandburgundy.co.uk');
`)
const vera = "aaaaaaaa-0000-0000-0000-000000000010"
const veraSees = await as(vera, () => q("select slug from public.clients order by slug"))
console.log(veraSees.length === 2 ? "viewer sees every client: OK" : `FAIL: viewer sees ${veraSees.length} clients`)

// Ad metrics (policy via my_client_ids(), 2026-10-01): the team sees its clients only; admins and viewers see all.
await db.exec(`insert into public.windsor_daily_metrics (client_id, platform, external_account_id, date, spend) values
  ('11111111-1111-1111-1111-111111111111','linkedin','c1','2026-09-30',10), ('22222222-2222-2222-2222-222222222222','linkedin','d1','2026-09-30',20)`)
const metricClients = async (uid) => (await as(uid, () => q("select distinct client_id from public.windsor_daily_metrics"))).length
console.log((await metricClients("aaaaaaaa-0000-0000-0000-000000000003")) === 1 ? "team sees only its clients' metrics: OK" : "FAIL: metrics visible across clients")
console.log((await metricClients("aaaaaaaa-0000-0000-0000-000000000001")) === 2 ? "admin sees every client's metrics: OK" : "FAIL: admin can't see all metrics")
console.log((await metricClients(vera)) === 2 ? "viewer sees every client's metrics: OK" : "FAIL: viewer can't see all metrics")
console.log((await metricClients("aaaaaaaa-0000-0000-0000-000000000004")) === 0 ? "no role sees no metrics: OK" : "FAIL: no-role user sees metrics")
const veraRuns = await as(vera, () => q("select id from public.check_runs"))
console.log(veraRuns.length > 0 ? "viewer reads check runs: OK" : "FAIL: viewer can't read runs")
try { await as(vera, () => q("insert into public.check_runs (client_id,cadence,period_start,period_end) values ('11111111-1111-1111-1111-111111111111','monthly','2026-09-01','2026-09-30')")); console.log("FAIL: viewer created a run") } catch { console.log("viewer can't create runs: OK") }
const veraUpd = await as(vera, () => q("update public.check_results set findings = 'x' returning id"))
console.log(veraUpd.length === 0 ? "viewer can't update results: OK" : "FAIL: viewer updated results")
try { await as(vera, () => q("insert into public.sprints (client_id, number, start_date, end_date) values ('22222222-2222-2222-2222-222222222222', 99, '2030-01-07', '2030-01-20')")); console.log("FAIL: viewer created a sprint") } catch { console.log("viewer can't create sprints: OK") }
try { await as(vera, () => q("insert into public.client_knowledge (client_id, source, category, title, content) values ('11111111-1111-1111-1111-111111111111','note','note','x','x')")); console.log("FAIL: viewer added a note") } catch { console.log("viewer can't add notes: OK") }
const veraEdit = await as(vera, () => q("select public.can_edit_client('11111111-1111-1111-1111-111111111111') as ok"))
const andreaEdit = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("select public.can_edit_client('11111111-1111-1111-1111-111111111111') as ok"))
console.log(!veraEdit[0].ok && andreaEdit[0].ok ? "can_edit_client: viewer no, team member yes: OK" : "FAIL: can_edit_client")

// Client goals: the team reads its client's goals; only admins set them; no deletes.
const goal = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q(`insert into public.client_goals (client_id, name, monthly_target) values ('11111111-1111-1111-1111-111111111111', 'Demos', 50) returning id`))
const gv = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q(`insert into public.client_goal_values (goal_id, client_id, month, value) values ('${goal[0].id}', '11111111-1111-1111-1111-111111111111', '2026-09-01', 12) returning value`))
console.log(goal.length === 1 && gv.length === 1 ? "admin sets a client goal: OK" : "FAIL: admin couldn't set a goal")
try { await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`insert into public.client_goal_values (goal_id, client_id, month, value) values ('${goal[0].id}', '11111111-1111-1111-1111-111111111111', '2026-08-01', 9)`)); console.log("FAIL: specialist set a goal value") } catch { console.log("specialist can't set goal figures: OK") }
const andreaSees = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("select value from public.client_goal_values"))
const dannySees = await as("aaaaaaaa-0000-0000-0000-000000000003", () => q("select value from public.client_goal_values"))
console.log(andreaSees.length === 1 && dannySees.length === 0 ? "goals are read by the client's team only: OK" : "FAIL: goal visibility")
const goalDel = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("delete from public.client_goal_values returning value"))
console.log(goalDel.length === 0 ? "goal figures can't be deleted: OK" : "FAIL: goal figure deleted")

// Report links: admins, GTM leads and the client's AMs create and turn off links; specialists and
// viewers can't; other columns can't be changed; nothing is deleted.
const tok = (c) => c.repeat(40)
const adminLink = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q(`insert into public.report_links (client_id, board, token, created_by_profile_id) values ('11111111-1111-1111-1111-111111111111', 'all', '${tok("a")}', 'aaaaaaaa-0000-0000-0000-000000000001') returning id`))
const amLink = await as("aaaaaaaa-0000-0000-0000-000000000003", () => q(`insert into public.report_links (client_id, board, token, created_by_profile_id) values ('22222222-2222-2222-2222-222222222222', 'linkedin', '${tok("b")}', 'aaaaaaaa-0000-0000-0000-000000000003') returning id`))
console.log(adminLink.length === 1 && amLink.length === 1 ? "admin and the client's AM create report links: OK" : "FAIL: report link create")
try { await as("aaaaaaaa-0000-0000-0000-000000000003", () => q(`insert into public.report_links (client_id, board, token, created_by_profile_id) values ('11111111-1111-1111-1111-111111111111', 'all', '${tok("c")}', 'aaaaaaaa-0000-0000-0000-000000000003')`)); console.log("FAIL: AM shared another client's report") } catch { console.log("AM can't share another client's report: OK") }
try { await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`insert into public.report_links (client_id, board, token, created_by_profile_id) values ('11111111-1111-1111-1111-111111111111', 'all', '${tok("d")}', 'aaaaaaaa-0000-0000-0000-000000000002')`)); console.log("FAIL: specialist created a link") } catch { console.log("specialist can't create report links: OK") }
try { await as(vera, () => q(`insert into public.report_links (client_id, board, token, created_by_profile_id) values ('11111111-1111-1111-1111-111111111111', 'all', '${tok("e")}', '${vera}')`)); console.log("FAIL: viewer created a link") } catch { console.log("viewer can't create report links: OK") }
const veraLinks = await as(vera, () => q("select id from public.report_links"))
const dannyLinks = await as("aaaaaaaa-0000-0000-0000-000000000003", () => q("select id from public.report_links"))
console.log(veraLinks.length === 0 && dannyLinks.length === 1 ? "report links are read by the client's team only (not viewers): OK" : `FAIL: link visibility (viewer ${veraLinks.length}, AM ${dannyLinks.length})`)
try { await as("aaaaaaaa-0000-0000-0000-000000000003", () => q(`update public.report_links set board = 'meta' where id = '${amLink[0].id}'`)); console.log("FAIL: AM changed a link's board") } catch { console.log("a link's board and client can't be changed: OK") }
const off = await as("aaaaaaaa-0000-0000-0000-000000000003", () => q(`update public.report_links set revoked_at = now(), revoked_by_profile_id = 'aaaaaaaa-0000-0000-0000-000000000003' where id = '${amLink[0].id}' returning id`))
console.log(off.length === 1 ? "AM turns a link off: OK" : "FAIL: AM couldn't turn a link off")
const linkDel = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("delete from public.report_links returning id"))
console.log(linkDel.length === 0 ? "report links can't be deleted: OK" : "FAIL: report link deleted")

// Content ideas: runs are written by the server; the client's team reads them and logs what it did
// with an idea (not viewers, not other clients); nothing is changed or deleted.
const ideaRun = (await q(`insert into public.content_idea_runs (client_id, status, ideas) values ('11111111-1111-1111-1111-111111111111', 'ready', '[{"id":"x-1","title":"Idea"}]') returning id`))[0].id
const andreaRuns = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("select id from public.content_idea_runs"))
const dannyRuns = await as("aaaaaaaa-0000-0000-0000-000000000003", () => q("select id from public.content_idea_runs"))
console.log(andreaRuns.length === 1 && dannyRuns.length === 0 ? "content idea runs are read by the client's team only: OK" : "FAIL: content idea run visibility")
try { await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`insert into public.content_idea_runs (client_id) values ('11111111-1111-1111-1111-111111111111')`)); console.log("FAIL: team member started a run directly") } catch { console.log("only the server writes content idea runs: OK") }
const logged = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`insert into public.content_idea_actions (client_id, run_id, idea_id, action, reason, profile_id) values ('11111111-1111-1111-1111-111111111111', '${ideaRun}', 'x-1', 'dismissed', 'Not our ICP', 'aaaaaaaa-0000-0000-0000-000000000002') returning id`))
console.log(logged.length === 1 ? "team member logs a content idea decision: OK" : "FAIL: team couldn't log a decision")
try { await as(vera, () => q(`insert into public.content_idea_actions (client_id, run_id, idea_id, action, profile_id) values ('11111111-1111-1111-1111-111111111111', '${ideaRun}', 'x-1', 'reopened', '${vera}')`)); console.log("FAIL: viewer logged a decision") } catch { console.log("viewer can't log content idea decisions: OK") }
try { await as("aaaaaaaa-0000-0000-0000-000000000003", () => q(`insert into public.content_idea_actions (client_id, run_id, idea_id, action, profile_id) values ('11111111-1111-1111-1111-111111111111', '${ideaRun}', 'x-1', 'reopened', 'aaaaaaaa-0000-0000-0000-000000000003')`)); console.log("FAIL: other client's AM logged a decision") } catch { console.log("other clients' team can't log decisions: OK") }
const ideaDel = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("delete from public.content_idea_actions returning id"))
const ideaUpd = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("update public.content_idea_actions set reason = 'x' returning id"))
console.log(ideaDel.length === 0 && ideaUpd.length === 0 ? "content idea decisions can't be changed or deleted: OK" : "FAIL: decision changed or deleted")

// Archived sprint tests (archived_at) are hidden from everyone signed in, admins included, and still never deleted.
await q(`update public.sprint_tests set archived_at = now() where id = '${t1[0].id}'`)
const andreaArchived = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`select id from public.sprint_tests where id = '${t1[0].id}'`))
const deanArchived = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q(`select id from public.sprint_tests where id = '${t1[0].id}'`))
const archivedRow = await q(`select id from public.sprint_tests where id = '${t1[0].id}'`)
console.log(andreaArchived.length === 0 && deanArchived.length === 0 && archivedRow.length === 1 ? "archived tests are hidden, not deleted: OK" : "FAIL: archived test visibility")

// Client calls (call notes read from Notion) and what was said on them: the server writes calls and
// commitments; the client's team (not viewers, not other clients' teams) logs what they did about one.
const call = await q(`insert into public.client_calls (client_id, source, title, call_date) values ('11111111-1111-1111-1111-111111111111', 'manual', 'Weekly sync', '2026-09-23') returning id`)
const said = await q(`insert into public.call_commitments (client_id, call_id, kind, title, said_on) values ('11111111-1111-1111-1111-111111111111', '${call[0].id}', 'try', 'Try thought leader ads', '2026-09-23') returning id`)
const andreaCalls = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("select id from public.client_calls"))
const dannyCalls = await as("aaaaaaaa-0000-0000-0000-000000000003", () => q("select id from public.call_commitments"))
console.log(andreaCalls.length === 1 && dannyCalls.length === 0 ? "calls are read by the client's team only: OK" : "FAIL: call visibility")
try { await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`insert into public.client_calls (client_id, source, title, call_date) values ('11111111-1111-1111-1111-111111111111', 'manual', 'x', '2026-09-23')`)); console.log("FAIL: team member wrote a call directly") } catch { console.log("only the server writes calls: OK") }
try { await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`insert into public.call_commitments (client_id, call_id, kind, title, said_on) values ('11111111-1111-1111-1111-111111111111', '${call[0].id}', 'idea', 'x', '2026-09-23')`)); console.log("FAIL: team member wrote a commitment directly") } catch { console.log("only the server writes commitments: OK") }
const done = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`insert into public.call_commitment_actions (client_id, commitment_id, action, profile_id) values ('11111111-1111-1111-1111-111111111111', '${said[0].id}', 'done', 'aaaaaaaa-0000-0000-0000-000000000002') returning id`))
console.log(done.length === 1 ? "team member marks a call follow-up done: OK" : "FAIL: couldn't log a follow-up")
try { await as(vera, () => q(`insert into public.call_commitment_actions (client_id, commitment_id, action, profile_id) values ('11111111-1111-1111-1111-111111111111', '${said[0].id}', 'done', '${vera}')`)); console.log("FAIL: viewer logged a follow-up") } catch { console.log("viewer can't log call follow-ups: OK") }
try { await as("aaaaaaaa-0000-0000-0000-000000000003", () => q(`insert into public.call_commitment_actions (client_id, commitment_id, action, profile_id) values ('11111111-1111-1111-1111-111111111111', '${said[0].id}', 'done', 'aaaaaaaa-0000-0000-0000-000000000003')`)); console.log("FAIL: other client's AM logged a follow-up") } catch { console.log("other clients' team can't log call follow-ups: OK") }
try { await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`insert into public.call_commitment_actions (client_id, commitment_id, action, profile_id) values ('11111111-1111-1111-1111-111111111111', '${said[0].id}', 'done', 'aaaaaaaa-0000-0000-0000-000000000001')`)); console.log("FAIL: logged a follow-up as someone else") } catch { console.log("follow-ups are logged as yourself: OK") }
const callDel = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("with a as (delete from public.call_commitment_actions returning id), b as (delete from public.call_commitments returning id), c as (delete from public.client_calls returning id) select (select count(*) from a) + (select count(*) from b) + (select count(*) from c) as n"))
const callUpd = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("update public.call_commitments set title = 'x' returning id"))
console.log(Number(callDel[0].n) === 0 && callUpd.length === 0 ? "calls and follow-ups can't be changed or deleted: OK" : "FAIL: call data changed or deleted")

// Benchmark labels (Dean, 2026-09-30): ad labels are server-written and read by the client's team;
// conversion tiers are read by the team and set by admins only; neither can be deleted.
const acct = await q(`insert into public.client_platform_accounts (client_id, platform, windsor_connector, external_account_id) values ('11111111-1111-1111-1111-111111111111', 'linkedin', 'linkedin', 'rls-1') returning id`)
await q(`insert into public.ad_labels (client_id, platform, external_account_id, ad_id, format, content_type, offer, hook, basis, confidence, input_digest, model) values ('11111111-1111-1111-1111-111111111111', 'linkedin', 'rls-1', 'ad-1', 'Document', 'Report', 'Download', 'Stat / data', 'image', 'high', 'x', 'test')`)
const andreaLabels = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("select id from public.ad_labels"))
const dannyLabels = await as("aaaaaaaa-0000-0000-0000-000000000003", () => q("select id from public.ad_labels"))
console.log(andreaLabels.length === 1 && dannyLabels.length === 0 ? "ad labels are read by the client's team only: OK" : "FAIL: ad label visibility")
try { await as("aaaaaaaa-0000-0000-0000-000000000001", () => q(`insert into public.ad_labels (client_id, platform, external_account_id, ad_id, format, content_type, offer, hook, basis, confidence, input_digest, model) values ('11111111-1111-1111-1111-111111111111', 'linkedin', 'rls-1', 'ad-2', 'Video', 'Other', 'Other', 'Other', 'name', 'low', 'x', 'test')`)); console.log("FAIL: signed-in user wrote an ad label") } catch { console.log("only the server writes ad labels: OK") }
try { await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`insert into public.conversion_field_tiers (client_id, account_id, field, tier) values ('11111111-1111-1111-1111-111111111111', '${acct[0].id}', 'oneclickleads', 'lead')`)); console.log("FAIL: specialist set a conversion tier") } catch { console.log("only admins set conversion tiers: OK") }
const tier = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q(`insert into public.conversion_field_tiers (client_id, account_id, field, tier) values ('11111111-1111-1111-1111-111111111111', '${acct[0].id}', 'oneclickleads', 'lead') returning id`))
const andreaTiers = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("select id from public.conversion_field_tiers"))
console.log(tier.length === 1 && andreaTiers.length === 1 ? "admins set conversion tiers, the team reads them: OK" : "FAIL: conversion tier write or read")
try { await q(`insert into public.conversion_field_tiers (client_id, account_id, field, tier) values ('11111111-1111-1111-1111-111111111111', '${acct[0].id}', 'x', 'hot_lead')`); console.log("FAIL: unknown tier accepted") } catch { console.log("conversion tiers come from the fixed list: OK") }
const labelDel = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("with a as (delete from public.ad_labels returning id), b as (delete from public.conversion_field_tiers returning id) select (select count(*) from a) + (select count(*) from b) as n"))
console.log(Number(labelDel[0].n) === 0 ? "labels and tiers can't be deleted: OK" : "FAIL: label or tier deleted")
try { await q(`update public.clients set regions = '{mars}' where id = '11111111-1111-1111-1111-111111111111'`); console.log("FAIL: unknown region accepted") } catch { console.log("client regions come from the fixed list: OK") }

// Aikido hardening (migration 20261013000057): one live Notion page per test brief, and profile
// pictures only through the server.
{
  const t = await q(`select id, client_id from public.sprint_tests limit 1`)
  const row = (dry, success) => `insert into public.notion_write_log (client_id, sprint_test_id, operation, endpoint, payload, dry_run, success) values ('${t[0].client_id}', '${t[0].id}', 'create_test_brief', 'POST /v1/pages', '{}', ${dry}, ${success})`
  await q(row(true, true)); await q(row(true, true))
  console.log("dry runs of the same brief are allowed: OK")
  await q(row(false, false))
  await q(row(false, null))
  try { await q(row(false, null)); console.log("FAIL: second live brief for the same test logged") } catch { console.log("one live Notion brief per test (a failed one can be retried): OK") }
  await db.exec(`grant usage on schema storage to authenticated; grant select, insert, update on storage.objects to authenticated`)
  try {
    await as("aaaaaaaa-0000-0000-0000-000000000002", () => q(`insert into storage.objects (bucket_id, name) values ('avatars', 'aaaaaaaa-0000-0000-0000-000000000002/x.html')`))
    console.log("FAIL: signed-in user wrote the avatars bucket directly")
  } catch { console.log("profile pictures only go through the server: OK") }
}

// Content library (migration 20261014000058): the client's team adds and edits pieces and sequences;
// viewers and other clients' teams can't; approval, Notion and Claude's pick are the server's; archiving
// is for admins; editing an approved sequence sends it back for approval; nothing is deleted.
{
  const andrea = "aaaaaaaa-0000-0000-0000-000000000002", danny = "aaaaaaaa-0000-0000-0000-000000000003", dean = "aaaaaaaa-0000-0000-0000-000000000001"
  const camber = "11111111-1111-1111-1111-111111111111", dnsf = "22222222-2222-2222-2222-222222222222"
  const piece = (code, client = camber) => `insert into public.content_pieces (client_id, code, title, type) values ('${client}', '${code}', 'Piece ${code}', 'Guide') returning id`
  const tries = async (what, uid, sql) => {
    try { await as(uid, () => q(sql)); console.log(`FAIL: ${what}`) } catch { console.log(`blocked, ${what}: OK`) }
  }
  const p1 = (await as(andrea, () => q(piece("C01"))))[0].id
  const p2 = (await as(andrea, () => q(piece("C02"))))[0].id
  const other = (await q(piece("C01", dnsf)))[0].id
  console.log(p1 && p2 ? "team member adds content: OK" : "FAIL: team couldn't add content")
  await tries("viewer adds content", vera, piece("C03"))
  await tries("other client's AM adds content", danny, piece("C03"))
  await tries("add content already approved", andrea, `insert into public.content_pieces (client_id, code, title, type, seq_status) values ('${camber}', 'C04', 'x', 'Guide', 'approved')`)
  const slot1 = await as(andrea, () => q(`insert into public.content_sequences (piece_id, slot, client_id, target_piece_id, angle) values ('${p1}', 1, '${camber}', '${p2}', 'Go deeper') returning slot`))
  console.log(slot1.length === 1 ? "team member sets a sequence email: OK" : "FAIL: sequence email")
  await tries("send another client's content in a sequence", andrea, `insert into public.content_sequences (piece_id, slot, client_id, target_piece_id) values ('${p1}', 2, '${camber}', '${other}')`)
  await tries("send a piece in its own sequence", andrea, `insert into public.content_sequences (piece_id, slot, client_id, target_piece_id) values ('${p1}', 3, '${camber}', '${p1}')`)
  await tries("set Claude's pick by hand", andrea, `update public.content_sequences set suggested_target_piece_id = '${p2}' where piece_id = '${p1}' and slot = 1`)
  await tries("approve a sequence by hand", andrea, `update public.content_pieces set seq_status = 'approved' where id = '${p1}'`)
  await tries("set the Notion brief by hand", andrea, `update public.content_pieces set notion_page_id = 'abc' where id = '${p1}'`)
  await tries("archive content (team member)", andrea, `update public.content_pieces set archived_at = now() where id = '${p2}'`)
  await tries("change a piece's code", andrea, `update public.content_pieces set code = 'C09' where id = '${p1}'`)
  const notReq = await as(andrea, () => q(`update public.content_pieces set seq_status = 'not_required' where id = '${p2}' returning id`))
  const veraEdits = await as(vera, () => q(`update public.content_pieces set title = 'x' where client_id = '${camber}' returning id`))
  const dannyEdits = await as(danny, () => q(`update public.content_pieces set title = 'x' where client_id = '${camber}' returning id`))
  console.log(notReq.length === 1 && veraEdits.length === 0 && dannyEdits.length === 0 ? "team marks not required; viewers and other teams can't edit: OK" : `FAIL: content edit scoping (team ${notReq.length}, viewer ${veraEdits.length}, other AM ${dannyEdits.length})`)
  // The server approves (Notion brief sent), then a team member changes the sequence.
  await q(`update public.content_pieces set seq_status = 'approved', approved_at = now(), approval_round = 1, notion_page_id = 'n1' where id = '${p1}'`)
  await q(`update public.content_sequences set suggested_target_piece_id = '${p2}', suggested_angle = 'Go deeper', suggested_at = now() where piece_id = '${p1}' and slot = 1`)
  await as(andrea, () => q(`update public.content_sequences set angle = 'A sharper hook' where piece_id = '${p1}' and slot = 1`))
  // Revert to Claude's pick (the sequence builder): the team copies Claude's pick back; the pick itself is untouched.
  const reverted = await as(andrea, () => q(`update public.content_sequences set target_piece_id = suggested_target_piece_id, handoff = coalesce(suggested_handoff, false), angle = suggested_angle where piece_id = '${p1}' and slot = 1 returning angle`))
  await as(andrea, () => q(`update public.content_sequences set angle = 'A sharper hook' where piece_id = '${p1}' and slot = 1`))
  console.log(reverted.length === 1 && reverted[0].angle === "Go deeper" ? "team member reverts an email to Claude's pick: OK" : "FAIL: revert to Claude's pick")
  const back = await q(`select seq_status, reapproval, notion_page_id from public.content_pieces where id = '${p1}'`)
  console.log(back[0].seq_status === "pending" && back[0].reapproval && back[0].notion_page_id === "n1" ? "editing an approved sequence sends it back for approval: OK" : `FAIL: reapproval (${JSON.stringify(back[0])})`)
  const andreaSees = await as(andrea, () => q("select id from public.content_pieces"))
  const veraSees = await as(vera, () => q("select id from public.content_pieces where client_id = '11111111-1111-1111-1111-111111111111'"))
  const dannySees = await as(danny, () => q("select id from public.content_pieces where client_id = '11111111-1111-1111-1111-111111111111'"))
  console.log(andreaSees.length === 2 && veraSees.length === 2 && dannySees.length === 0 ? "content is read by the client's team and viewers only: OK" : "FAIL: content visibility")
  // Archived rows are hidden by the read policy, so archiving goes through the server (after the app's
  // admin check), as with sprint tests.
  const archived = await q(`update public.content_pieces set archived_at = now(), archived_by_profile_id = '${dean}' where id = '${p2}' returning id`)
  const hidden = await as(andrea, () => q(`select id from public.content_pieces where id = '${p2}'`))
  const kept = await q(`select id from public.content_pieces where id = '${p2}'`)
  console.log(archived.length === 1 && hidden.length === 0 && kept.length === 1 ? "admins archive content; it's hidden, not deleted: OK" : "FAIL: content archive")
  const contentDel = await as(dean, () => q("with a as (delete from public.content_sequences returning 1), b as (delete from public.content_pieces returning 1) select (select count(*) from a) + (select count(*) from b) as n"))
  console.log(Number(contentDel[0].n) === 0 ? "content and sequences can't be deleted: OK" : "FAIL: content deleted")
  // One live Notion sequence brief per key; dry runs and failed sends can repeat.
  const brief = (dry, success, key = `sequence:${p1}:1`) => `insert into public.notion_write_log (client_id, content_piece_id, brief_key, operation, endpoint, payload, dry_run, success) values ('${camber}', '${p1}', '${key}', 'create_sequence_brief', 'POST /v1/pages', '{}', ${dry}, ${success})`
  await q(brief(true, true)); await q(brief(true, true)); await q(brief(false, false)); await q(brief(false, null))
  try { await q(brief(false, null)); console.log("FAIL: second live sequence brief logged") } catch { console.log("one live Notion brief per sequence approval: OK") }
  await q(brief(false, null, `sequence:${p1}:2`))
  console.log("a re-approval gets its own brief: OK")
  try { await q(`insert into public.notion_write_log (client_id, operation, endpoint, payload, dry_run) values ('${camber}', 'create_sequence_brief', 'POST /v1/pages', '{}', true)`); console.log("FAIL: sequence brief without a key") } catch { console.log("sequence briefs need a piece and a key: OK") }
}

// client_data_range (2026-10-15): the fast replacement for the account_data_range view keeps its RLS.
{
  const camber = "11111111-1111-1111-1111-111111111111"
  const andrea = "aaaaaaaa-0000-0000-0000-000000000002" // Camber's team
  const danny = "aaaaaaaa-0000-0000-0000-000000000003" // DNSFilter's team, not Camber's
  await q(`insert into public.windsor_daily_metrics (client_id, platform, external_account_id, date, campaign_id, ad_id, impressions) values
    ('${camber}', 'linkedin', 'li-1', '2026-09-01', 'c1', 'a1', 10), ('${camber}', 'linkedin', 'li-1', '2026-10-14', 'c1', 'a1', 10),
    ('${camber}', 'meta', 'fb-1', '2026-10-01', 'c2', 'a2', 0), ('${camber}', 'meta', 'fb-1', '2026-10-13', 'c2', 'a2', 5)`)
  const range = (uid) => as(uid, () => q(`select platform::text, external_account_id, data_from::text, data_through::text from public.client_data_range('${camber}') order by 1, 2`))
  const mine = await range(andrea)
  const view = await as(andrea, () => q(`select platform::text, external_account_id, data_from::text, data_through::text from public.account_data_range where client_id = '${camber}' order by 1, 2`))
  console.log(JSON.stringify(mine) === JSON.stringify(view) && mine.length >= 2 ? "client_data_range matches the view for the team: OK" : `FAIL: client_data_range ${JSON.stringify(mine)} vs view ${JSON.stringify(view)}`)
  console.log((await range(danny)).length === 0 ? "client_data_range shows nothing to someone off the team: OK" : "FAIL: client_data_range leaked another client's range")
  const fatigue = await as(andrea, () => q(`select ad_id, first_seen::text, live from public.ad_fatigue_inputs('${camber}') order by ad_id`))
  console.log(fatigue.length === 2 && fatigue[1].first_seen === "2026-10-13" ? "ad_fatigue_inputs reads recent ads, first seen = first day with impressions: OK" : `FAIL: ad_fatigue_inputs ${JSON.stringify(fatigue)}`)
  // sprint_ad_events (bounded by the range, 2026-10-15): a2 started in the range; a1 still runs on the last day.
  const events = (uid) => as(uid, () => q(`select ad_id, first_seen::text, data_through::text from public.sprint_ad_events('${camber}', '2026-10-12', '2026-10-25') order by ad_id`))
  const ev = await events(andrea)
  console.log(ev.length === 1 && ev[0].ad_id === "a2" && ev[0].first_seen === "2026-10-13" && ev[0].data_through === "2026-10-13" ? "sprint_ad_events finds ads that started in the sprint: OK" : `FAIL: sprint_ad_events ${JSON.stringify(ev)}`)
  console.log((await events(danny)).length === 0 ? "sprint_ad_events shows nothing to someone off the team: OK" : "FAIL: sprint_ad_events leaked another client's ads")
}

// ad_fatigue_snapshots (2026-10-15): server-written once a day, the client's team reads, nobody else.
{
  const camber = "11111111-1111-1111-1111-111111111111"
  await q(`insert into public.ad_fatigue_snapshots (client_id, snapshot_on, data_through, ad_count, rows) values ('${camber}', '2026-10-15', '2026-10-14', 1, '[{"ad_id":"a1"}]')`)
  const team = await as("aaaaaaaa-0000-0000-0000-000000000002", () => q("select ad_count from public.ad_fatigue_snapshots"))
  console.log(team.length === 1 ? "ad fatigue snapshots: the team reads them: OK" : "FAIL: team can't read ad fatigue snapshots")
  const other = await as("aaaaaaaa-0000-0000-0000-000000000003", () => q("select ad_count from public.ad_fatigue_snapshots"))
  console.log(other.length === 0 ? "ad fatigue snapshots: hidden from other teams: OK" : "FAIL: another team read Camber's snapshot")
  try { await as("aaaaaaaa-0000-0000-0000-000000000001", () => q(`insert into public.ad_fatigue_snapshots (client_id, snapshot_on, ad_count) values ('${camber}', '2026-10-16', 0)`)); console.log("FAIL: a signed-in user wrote a snapshot") } catch { console.log("ad fatigue snapshots are server-written: OK") }
  const del = await as("aaaaaaaa-0000-0000-0000-000000000001", () => q("delete from public.ad_fatigue_snapshots returning id"))
  console.log(del.length === 0 ? "ad fatigue snapshots can't be deleted: OK" : "FAIL: snapshot deleted")
}
