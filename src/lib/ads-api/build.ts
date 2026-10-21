import { dryRunReason, type AdsApiEnv, type AdsApiPlatform } from "./gates"

/**
 * THE ONE PLACE A CAMPAIGN BUILD IS SENT TO AN AD PLATFORM'S OWN API (Dean, 2026-10-21).
 *
 * A build is a list of steps (campaign group → campaign → image → post → ad on LinkedIn), each one
 * API call that uses the ids the steps before it got back. For every step:
 *   1. log to platform_write_log first, with the exact request. No log, no write.
 *   2. dry run (the default, see gates.ts): stop there and hand the next step a placeholder id.
 *   3. live: send it through the platform's sender, which only knows its fixed list of create calls
 *      and forces every new campaign, ad group and ad to PAUSED. Then log the result.
 * A live step's log row carries an idempotency key (build + step). A step that already worked is
 * skipped on a retry; a step whose outcome is unknown (a timeout) keeps its key, so it is never sent
 * twice: check the platform first. A clear refusal frees the key so the step can be tried again.
 * Nothing here enables, edits, removes or deletes anything.
 */

export type BuildOperation = "create_campaign_group" | "create_campaign" | "create_ad_group" | "upload_image" | "create_post" | "create_ad"

export type BuildStep = {
  /** Unique within the build, e.g. "campaign", "ad:0". created_ids is keyed by it. */
  key: string
  operation: BuildOperation
  /** What this call sends, given the ids earlier steps returned. Must be pure. */
  payload: (ids: Record<string, string>) => Record<string, unknown>
}

/** Thrown by a sender when the platform clearly refused the call (a 4xx with a reason): nothing was created. */
export class PlatformRefused extends Error {
  constructor(
    message: string,
    readonly detail: unknown = null,
  ) {
    super(message)
  }
}

export type Sender = {
  /** Sends one create call and returns the new object's id. Throws PlatformRefused on a clear refusal. */
  send(operation: BuildOperation, accountId: string, payload: Record<string, unknown>): Promise<{ id: string; raw: unknown }>
}

export type LogRow = {
  profile_id: string
  client_id: string
  platform: AdsApiPlatform
  external_account_id: string
  campaign_id: string | null
  operation: BuildOperation
  payload: Record<string, unknown>
  dry_run: boolean
  campaign_build_id: string
  step: string
  idempotency_key: string | null
}

/** Only what the runner needs from the database (the admin client in production, a fake in tests). */
export type BuildStore = {
  /** Moves the build to "sending" unless it is already sending or created. False = someone else has it. */
  claim(buildId: string): Promise<boolean>
  log(row: LogRow): Promise<{ id: number } | { duplicate: true } | { error: string }>
  finishLog(id: number, values: { success: boolean; response: unknown; ad_id?: string | null; clearKey?: boolean }): Promise<void>
  saveBuild(buildId: string, values: BuildUpdate): Promise<void>
}

export type BuildUpdate = {
  status?: "created" | "partly_created" | "failed"
  created_ids?: Record<string, string>
  error?: string | null
  updated_at?: string
  completed_at?: string
  dry_run_at?: string
}

export type BuildDeps = { store: BuildStore; sender: Sender | null; env: AdsApiEnv; now?: () => Date }

export type Build = {
  id: string
  platform: AdsApiPlatform
  external_account_id: string
  created_ids: Record<string, string>
  client: { id: string; slug: string }
}

export type StepOutcome = { key: string; operation: BuildOperation; status: "skipped" | "dry_run" | "sent" | "failed"; id?: string; logId?: number; error?: string }
export type RunResult = { ok: boolean; live: boolean; status: "dry_run" | "created" | "partly_created" | "failed" | "busy"; steps: StepOutcome[]; ids: Record<string, string>; error?: string }

export async function runBuild(deps: BuildDeps, build: Build, steps: BuildStep[], by: { id: string }): Promise<RunResult> {
  const now = () => (deps.now ? deps.now() : new Date()).toISOString()
  const reason = dryRunReason(deps.env, build.platform, build.client.slug)
  const live = reason === null && deps.sender !== null
  const note = reason ?? "No sender: nothing was sent"

  if (live && !(await deps.store.claim(build.id))) {
    return { ok: false, live, status: "busy", steps: [], ids: build.created_ids, error: "This build is already being sent, or it was created." }
  }

  const ids: Record<string, string> = live ? { ...build.created_ids } : {}
  const outcomes: StepOutcome[] = []
  let stopped: string | null = null

  for (const step of steps) {
    if (stopped) break
    if (live && ids[step.key]) {
      outcomes.push({ key: step.key, operation: step.operation, status: "skipped", id: ids[step.key] })
      continue
    }
    const payload = step.payload(ids)
    const logged = await deps.store.log({
      profile_id: by.id,
      client_id: build.client.id,
      platform: build.platform,
      external_account_id: build.external_account_id,
      campaign_id: ids.campaign ?? null,
      operation: step.operation,
      payload,
      dry_run: !live,
      campaign_build_id: build.id,
      step: step.key,
      idempotency_key: live ? `build:${build.id}:${step.key}` : null,
    })
    if ("duplicate" in logged) {
      stopped = `An earlier attempt at "${step.key}" may have gone through. Check ${PLATFORM_NAME[build.platform]} before trying again.`
      outcomes.push({ key: step.key, operation: step.operation, status: "failed", error: stopped })
      break
    }
    if ("error" in logged) {
      stopped = `Couldn't write the log, so "${step.key}" wasn't sent.`
      outcomes.push({ key: step.key, operation: step.operation, status: "failed", error: stopped })
      break
    }

    if (!live || !deps.sender) {
      await deps.store.finishLog(logged.id, { success: true, response: { dry_run: true, note } })
      ids[step.key] = `dry-${logged.id}`
      outcomes.push({ key: step.key, operation: step.operation, status: "dry_run", id: ids[step.key], logId: logged.id })
      continue
    }

    try {
      const r = await deps.sender.send(step.operation, build.external_account_id, payload)
      ids[step.key] = r.id
      await deps.store.finishLog(logged.id, { success: true, response: r.raw ?? { id: r.id }, ad_id: step.operation === "create_ad" ? r.id : null })
      await deps.store.saveBuild(build.id, { created_ids: ids, updated_at: now() })
      outcomes.push({ key: step.key, operation: step.operation, status: "sent", id: r.id, logId: logged.id })
    } catch (e) {
      const refused = e instanceof PlatformRefused
      const message = (e as Error).message
      await deps.store.finishLog(logged.id, { success: false, response: { error: message, detail: refused ? e.detail : null }, clearKey: refused })
      stopped = refused ? message : `${message}. The call may still have gone through: check ${PLATFORM_NAME[build.platform]} before trying again.`
      outcomes.push({ key: step.key, operation: step.operation, status: "failed", logId: logged.id, error: stopped })
    }
  }

  if (!live) {
    await deps.store.saveBuild(build.id, { dry_run_at: now(), error: stopped, updated_at: now() })
    return { ok: !stopped, live, status: stopped ? "failed" : "dry_run", steps: outcomes, ids, ...(stopped ? { error: stopped } : {}) }
  }
  const createdAny = Object.keys(ids).length > 0
  const status: BuildUpdate["status"] = !stopped ? "created" : createdAny ? "partly_created" : "failed"
  await deps.store.saveBuild(build.id, { status, created_ids: ids, error: stopped, updated_at: now(), ...(stopped ? {} : { completed_at: now() }) })
  return { ok: !stopped, live, status, steps: outcomes, ids, ...(stopped ? { error: stopped } : {}) }
}

export const PLATFORM_NAME: Record<AdsApiPlatform, string> = { linkedin: "LinkedIn Campaign Manager", reddit: "Reddit Ads" }
