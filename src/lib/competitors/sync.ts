import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { COMPETITOR_IMAGE_HOSTS, copyImage } from "@/lib/windsor/creatives"
import { apifyConfigured, datasetItems, FINISHED, isBusy, runStatus, startRun } from "./apify"
import { COMPETITOR_SOURCES, COUNTRIES, keywordInput, KEYWORD_SOURCES, normalizeItems, normalizeKeywordItems, runIsHealthy, SOURCES, type Competitor, type CompetitorSource, type KeywordSource } from "./sources"

/**
 * Competitor ads, once a week (Dean, 2026-10-20). `queueWeek` adds one run per competitor × source ×
 * country, and per keyword × Meta/LinkedIn × country; `pump` starts queued runs while Apify has room
 * (the free plan runs 5 at once), collects finished ones into `competitor_ads` or `keyword_ads`,
 * closes competitor ads a healthy week no longer shows, and copies images into our bucket. Both are safe to call again: the cron calls `pump` every half hour on Sunday
 * morning. Reads the public ad libraries; writes only our database and storage.
 */
const MAX_RUNNING = 4
/** A run older than this that hasn't finished is given up on (Apify stops it at 10 minutes). */
const STALE_MS = 60 * 60_000
/** Runs queued within this window belong to the same weekly batch. */
const BATCH_MS = 3 * 86_400_000

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_")
const today = () => new Date().toISOString().slice(0, 10)

/** Clients in COMPETITOR_CLIENTS (slugs), or every client with competitors when it isn't set. */
async function clientIds(db = createAdminClient(), only?: string) {
  let q = db.from("clients").select("id, slug")
  if (only) q = q.eq("id", only)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const allowed = (process.env.COMPETITOR_CLIENTS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  return (data ?? []).filter((c) => !allowed.length || allowed.includes(c.slug)).map((c) => c.id)
}

async function competitors(clientId: string, db = createAdminClient()): Promise<(Competitor & { client_id: string })[]> {
  const { data, error } = await db
    .from("client_competitors")
    .select("id, client_id, name, meta_page_id, linkedin_advertiser, google_advertiser_ids")
    .eq("client_id", clientId)
    .is("removed_at", null)
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Queues this week's runs. Skips a competitor or keyword × source × country already queued or read in the last 3 days. */
export async function queueWeek(opts: { clientId?: string; force?: boolean; sources?: CompetitorSource[] } = {}) {
  if (!apifyConfigured()) return { queued: 0, skipped: "APIFY_TOKEN isn't set" }
  const db = createAdminClient()
  const since = new Date(Date.now() - BATCH_MS).toISOString()
  let queued = 0
  for (const clientId of await clientIds(db, opts.clientId)) {
    const [list, { data: keywords }] = await Promise.all([
      competitors(clientId, db),
      db.from("competitor_keywords").select("id, keyword, sources").eq("client_id", clientId).is("removed_at", null),
    ])
    if (!list.length && !keywords?.length) continue
    const { data: recent } = await db.from("competitor_runs").select("competitor_id, keyword_id, source, country").eq("client_id", clientId).gte("queued_at", since).neq("status", "failed")
    // `force` reads again anyway (e.g. after a change to what a read asks for); `sources` limits it.
    const done = new Set(opts.force ? [] : (recent ?? []).map((r) => `${r.competitor_id ?? r.keyword_id}|${r.source}|${r.country}`))
    const keywordRows = (keywords ?? []).flatMap((k) =>
      KEYWORD_SOURCES.filter((source) => k.sources.includes(source)).flatMap((source) =>
        COUNTRIES.filter((country) => !done.has(`${k.id}|${source}|${country}`)).map((country) => ({
          client_id: clientId,
          keyword_id: k.id,
          source,
          country,
          actor: SOURCES[source].actor,
        })),
      ),
    )
    const competitorRows = list.flatMap((c) =>
      COMPETITOR_SOURCES.flatMap((source) =>
        COUNTRIES.filter((country) => SOURCES[source].input(c, country) && !done.has(`${c.id}|${source}|${country}`)).map((country) => ({
          client_id: clientId,
          competitor_id: c.id,
          source,
          country,
          actor: SOURCES[source].actor,
        })),
      ),
    )
    const rows = [...competitorRows, ...keywordRows].filter((r) => !opts.sources || opts.sources.includes(r.source))
    if (rows.length) {
      const { error } = await db.from("competitor_runs").insert(rows)
      if (error) throw new Error(error.message)
      queued += rows.length
    }
  }
  return { queued }
}

type RunRow = { id: string; client_id: string; competitor_id: string | null; keyword_id: string | null; source: string; country: string; actor: string; apify_run_id: string | null; queued_at: string; started_at: string | null }

/** Collects finished runs, starts queued ones, closes stale ads and copies images, within `stopAt`. */
export async function pump(opts: { stopAt?: number; maxCopies?: number; clientId?: string } = {}) {
  const stopAt = opts.stopAt ?? Date.now() + 240_000
  const result = { collected: 0, started: 0, failed: 0, ads: 0, closed: 0, copied: 0, open: 0, errors: [] as string[] }
  if (!apifyConfigured()) return { ...result, errors: ["APIFY_TOKEN isn't set"] }
  const db = createAdminClient()
  const scope = await clientIds(db, opts.clientId)
  if (!scope.length) return result
  const cols = "id, client_id, competitor_id, keyword_id, source, country, actor, apify_run_id, queued_at, started_at"

  // 1. Finished runs → ads.
  const { data: running } = await db.from("competitor_runs").select(cols).eq("status", "started").in("client_id", scope)
  const touched = new Set<string>()
  for (const run of (running ?? []) as RunRow[]) {
    if (Date.now() > stopAt) break
    try {
      const status = await runStatus(run.apify_run_id!)
      if (!FINISHED.includes(status.status)) {
        if (Date.now() - Date.parse(run.started_at ?? run.queued_at) > STALE_MS) await fail(run.id, `Still ${status.status} after an hour`)
        continue
      }
      if (status.status !== "SUCCEEDED") {
        await fail(run.id, `Apify run ${status.status.toLowerCase()}`, status.usageTotalUsd)
        result.failed++
        continue
      }
      const items = await datasetItems(status.defaultDatasetId)
      result.ads += run.keyword_id ? await collectKeyword(run, items, status.usageTotalUsd) : await collect(run, items, status.usageTotalUsd)
      result.collected++
      if (run.competitor_id) touched.add(`${run.competitor_id}|${run.source}`)
    } catch (e) {
      result.errors.push(`${run.source} ${run.country}: ${(e as Error).message}`)
    }
  }

  // 2. Start queued runs while there's room.
  const { count: busy } = await db.from("competitor_runs").select("id", { count: "exact", head: true }).eq("status", "started")
  let room = MAX_RUNNING - (busy ?? 0)
  if (room > 0) {
    const { data: queued } = await db.from("competitor_runs").select(cols).eq("status", "queued").in("client_id", scope).order("queued_at").limit(room)
    for (const run of (queued ?? []) as RunRow[]) {
      if (Date.now() > stopAt || room <= 0) break
      const source = run.source as CompetitorSource
      let input: Record<string, unknown> | null = null
      if (run.keyword_id) {
        const { data: k } = await db.from("competitor_keywords").select("keyword, removed_at").eq("id", run.keyword_id).single()
        input = k && !k.removed_at ? keywordInput(source as KeywordSource, k.keyword, run.country) : null
      } else {
        const { data: c } = await db.from("client_competitors").select("id, name, meta_page_id, linkedin_advertiser, google_advertiser_ids, removed_at").eq("id", run.competitor_id!).single()
        input = c && !c.removed_at ? SOURCES[source].input(c, run.country) : null
      }
      if (!input) {
        await fail(run.id, "No id for this library any more")
        continue
      }
      try {
        const started = await startRun(SOURCES[source].actor, input)
        await db.from("competitor_runs").update({ status: "started", apify_run_id: started.id, started_at: new Date().toISOString() }).eq("id", run.id)
        result.started++
        room--
      } catch (e) {
        if (isBusy(e)) break // Apify is full; the next pass starts it
        await fail(run.id, (e as Error).message)
        result.failed++
      }
    }
  }

  // 3. Close ads a finished, healthy week no longer shows.
  for (const key of touched) result.closed += await closeStale(...(key.split("|") as [string, CompetitorSource]))

  // 4. Images.
  result.copied = await copyImages(scope, opts.maxCopies ?? 150, stopAt)
  const { count: open } = await db.from("competitor_runs").select("id", { count: "exact", head: true }).in("client_id", scope).in("status", ["queued", "started"])
  result.open = open ?? 0
  return result
}

async function fail(runId: string, error: string, usage?: number) {
  await createAdminClient()
    .from("competitor_runs")
    .update({ status: "failed", error: error.slice(0, 300), collected_at: new Date().toISOString(), usage_usd: usage ?? null })
    .eq("id", runId)
}

async function collect(run: RunRow, items: unknown[], usage?: number) {
  const db = createAdminClient()
  const { data: c, error } = await db.from("client_competitors").select("id, name, meta_page_id, linkedin_advertiser, google_advertiser_ids").eq("id", run.competitor_id!).single()
  if (error || !c) throw new Error(error?.message ?? "Competitor not found")
  const ads = normalizeItems(run.source as CompetitorSource, items, c, today())
  const { count: liveBefore } = await db
    .from("competitor_ads")
    .select("id", { count: "exact", head: true })
    .eq("competitor_id", run.competitor_id!)
    .eq("source", run.source)
    .eq("active", true)
    .contains("countries", [run.country])
  const healthy = runIsHealthy(ads.length, liveBefore ?? 0)

  if (ads.length) {
    // Keep the countries an ad was seen in across runs.
    const { data: existing } = await db
      .from("competitor_ads")
      .select("external_id, countries")
      .eq("competitor_id", run.competitor_id!)
      .eq("source", run.source)
      .in("external_id", ads.map((a) => a.external_id))
    const countries = new Map((existing ?? []).map((e) => [e.external_id, e.countries]))
    const now = new Date().toISOString()
    const { error: upErr } = await db.from("competitor_ads").upsert(
      ads.map((a) => ({
        ...a,
        client_id: run.client_id,
        competitor_id: run.competitor_id!,
        source: run.source,
        countries: [...new Set([...(countries.get(a.external_id) ?? []), run.country])].sort(),
        last_seen_at: now,
      })),
      { onConflict: "competitor_id,source,external_id" },
    )
    if (upErr) throw new Error(upErr.message)
  }
  await db
    .from("competitor_runs")
    .update({
      status: healthy ? "collected" : "failed",
      error: healthy ? null : "No ads came back although the competitor had live ads here: kept them live",
      items: ads.length,
      usage_usd: usage ?? null,
      collected_at: new Date().toISOString(),
    })
    .eq("id", run.id)
  return ads.length
}

/** A keyword search's ads, with their place in this country's results. */
async function collectKeyword(run: RunRow, items: unknown[], usage?: number) {
  const db = createAdminClient()
  const ads = normalizeKeywordItems(run.source as KeywordSource, items, today())
  const { count: before } = await db.from("keyword_ads").select("id", { count: "exact", head: true }).eq("keyword_id", run.keyword_id!).eq("source", run.source).contains("countries", [run.country])
  const healthy = runIsHealthy(ads.length, before ?? 0)
  if (ads.length) {
    const { data: existing } = await db
      .from("keyword_ads")
      .select("external_id, countries, ranks")
      .eq("keyword_id", run.keyword_id!)
      .eq("source", run.source)
      .in("external_id", ads.map((a) => a.external_id))
    const prev = new Map((existing ?? []).map((e) => [e.external_id, e]))
    const now = new Date().toISOString()
    const { error } = await db.from("keyword_ads").upsert(
      ads.map((a) => {
        const p = prev.get(a.external_id)
        return {
          external_id: a.external_id,
          advertiser: a.advertiser,
          advertiser_id: a.advertiser_id,
          started_on: a.started_on,
          ended_on: a.ended_on,
          format: a.format,
          headline: a.headline,
          body: a.body,
          cta: a.cta,
          landing_url: a.landing_url,
          library_url: a.library_url,
          media_url: a.media_url,
          client_id: run.client_id,
          keyword_id: run.keyword_id!,
          source: run.source,
          countries: [...new Set([...(p?.countries ?? []), run.country])].sort(),
          // Stopped versions keep no place in this read.
          ranks: a.rank === null ? ((p?.ranks as Record<string, number> | null) ?? {}) : { ...((p?.ranks as Record<string, number> | null) ?? {}), [run.country]: a.rank },
          last_seen_at: now,
        }
      }),
      { onConflict: "keyword_id,source,external_id" },
    )
    if (error) throw new Error(error.message)
  }
  await db
    .from("competitor_runs")
    .update({
      status: healthy ? "collected" : "failed",
      error: healthy ? null : "No ads came back although this search had ads before",
      items: ads.length,
      usage_usd: usage ?? null,
      collected_at: new Date().toISOString(),
    })
    .eq("id", run.id)
  return ads.length
}

/**
 * Once every run of this week's batch for a competitor × source is done and none failed, ads not
 * seen since the batch started have stopped.
 */
async function closeStale(competitorId: string, source: CompetitorSource) {
  const db = createAdminClient()
  const { data: batch } = await db
    .from("competitor_runs")
    .select("status, queued_at")
    .eq("competitor_id", competitorId)
    .eq("source", source)
    .gte("queued_at", new Date(Date.now() - BATCH_MS).toISOString())
  if (!batch?.length || batch.some((r) => r.status !== "collected")) return 0
  const start = batch.map((r) => r.queued_at).sort()[0]
  const { data, error } = await db
    .from("competitor_ads")
    .update({ active: false, ended_on: today() })
    .eq("competitor_id", competitorId)
    .eq("source", source)
    .eq("active", true)
    .lt("last_seen_at", start)
    .select("id")
  if (error) throw new Error(error.message)
  return data?.length ?? 0
}

async function copyImages(scope: string[], budget: number, stopAt: number) {
  const copied = await copyFrom("competitor_ads", scope, budget, stopAt)
  return copied + (Date.now() < stopAt ? await copyFrom("keyword_ads", scope, budget - copied, stopAt) : 0)
}

/** Copies images for one table's ads we don't hold yet, newest first. Keyword ads go under competitor/keyword_<source>_<id>. */
async function copyFrom(table: "competitor_ads" | "keyword_ads", scope: string[], budget: number, stopAt: number) {
  if (budget <= 0) return 0
  const db = createAdminClient()
  const { data: todo } = await db
    .from(table)
    .select("id, client_id, source, external_id, media_url")
    .in("client_id", scope)
    .is("storage_path", null)
    .is("copy_error", null)
    .not("media_url", "is", null)
    .order("last_seen_at", { ascending: false })
    .limit(budget)
  let copied = 0
  for (const ad of todo ?? []) {
    if (Date.now() > stopAt) break
    try {
      const prefix = table === "keyword_ads" ? "keyword_" : ""
      const stored = await copyImage(ad.media_url!, `${ad.client_id}/competitor/${prefix}${ad.source}_${safe(ad.external_id)}`, COMPETITOR_IMAGE_HOSTS)
      await db.from(table).update(stored).eq("id", ad.id)
      copied++
    } catch (e) {
      await db.from(table).update({ copy_error: (e as Error).message.slice(0, 300) }).eq("id", ad.id)
    }
  }
  return copied
}
