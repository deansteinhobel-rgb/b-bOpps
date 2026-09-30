import { describe, expect, it, vi } from "vitest"
import { createNotionAction, type ActionInput, type WriteDb, type WriteDeps } from "./write"

// A fake Supabase that records every call, in order.
function fakeDb(opts: { failLogInsert?: boolean } = {}) {
  const calls: { table: string; op: string; args: unknown[] }[] = []
  const db: WriteDb = {
    from(table) {
      return {
        insert(row) {
          calls.push({ table, op: "insert", args: [row] })
          return { select: () => ({ single: async () => (opts.failLogInsert ? { data: null, error: { message: "db down" } } : { data: { id: 42 }, error: null }) }) }
        },
        update(values) {
          return {
            eq: async (col, val) => {
              calls.push({ table, op: "update", args: [values, col, val] })
              return { error: null }
            },
          }
        },
        upsert: async (rows, o) => {
          calls.push({ table, op: "upsert", args: [rows, o] })
          return { error: null }
        },
      }
    },
  }
  return { db, calls }
}

const page = {
  id: "page-1",
  url: "https://app.notion.com/p/page-1",
  last_edited_time: "2026-09-28T12:00:00.000Z",
  properties: {
    Project: { type: "title", title: [{ plain_text: "Camber: Meta overspend" }] },
    Client: { type: "select", select: { name: "Camber" } },
    "Brief Submitted by": { type: "rich_text", rich_text: [{ plain_text: "B&B Ops app · Andrea Restrepo" }] },
    "Master Status": { type: "status", status: { name: "New" } },
  },
}

function fakeNotion(fail = false) {
  // Only pages.create exists: if the code tried anything else (update, delete…) it would crash.
  return { pages: { create: vi.fn(async () => (fail ? Promise.reject(new Error("validation_error")) : page)) } }
}

const input: ActionInput = {
  client: { id: "client-camber", slug: "camber", notion_client_option: "Camber" },
  title: "Camber: Meta overspend",
  owner: { id: "p-andrea", full_name: "Andrea Restrepo", notion_user_id: "notion-andrea" },
  dueDate: "2026-10-05",
  description: "Meta is 33% above pace. Reduce daily budgets on SMB Lead Gen.",
  checkResultId: "result-1",
  createdBy: { id: "p-dean", full_name: "Dean Steinhobel", email: "dean.steinhobel@bordeauxandburgundy.co.uk" },
}

const env = (over: Partial<WriteDeps["env"]> = {}): WriteDeps["env"] => ({
  writesEnabled: false,
  dryRun: true,
  dataSourceId: "ds-master",
  appUrl: "http://localhost:3000",
  ...over,
})

describe("createNotionAction: safety", () => {
  it("is a dry run by default: logs, never calls Notion, doesn't link the check", async () => {
    const { db, calls } = fakeDb()
    const notion = fakeNotion()
    const res = await createNotionAction({ db, notion, env: env() }, input)
    expect(res.status).toBe("dry_run")
    expect(notion.pages.create).not.toHaveBeenCalled()
    expect(calls.map((c) => `${c.table}.${c.op}`)).toEqual(["notion_write_log.insert", "notion_write_log.update"])
    expect((calls[0].args[0] as { dry_run: boolean }).dry_run).toBe(true)
  })

  it.each([
    [{ writesEnabled: true, dryRun: true }],
    [{ writesEnabled: false, dryRun: false }],
  ])("needs BOTH switches: %o stays a dry run", async (flags) => {
    const { db } = fakeDb()
    const notion = fakeNotion()
    const res = await createNotionAction({ db, notion, env: env(flags) }, input)
    expect(res.status).toBe("dry_run")
    expect(notion.pages.create).not.toHaveBeenCalled()
  })

  it("stays a dry run if no Notion client was provided, even with both switches on", async () => {
    const { db } = fakeDb()
    const res = await createNotionAction({ db, notion: null, env: env({ writesEnabled: true, dryRun: false }) }, input)
    expect(res.status).toBe("dry_run")
  })

  it("never calls Notion when the log can't be written", async () => {
    const { db } = fakeDb({ failLogInsert: true })
    const notion = fakeNotion()
    const res = await createNotionAction({ db, notion, env: env({ writesEnabled: true, dryRun: false }) }, input)
    expect(res.status).toBe("failed")
    expect(notion.pages.create).not.toHaveBeenCalled()
  })

  it("refuses an owner with no Notion user, before logging or calling anything", async () => {
    const { db, calls } = fakeDb()
    const notion = fakeNotion()
    const res = await createNotionAction({ db, notion, env: env({ writesEnabled: true, dryRun: false }) }, { ...input, owner: { ...input.owner, notion_user_id: null } })
    expect(res.status).toBe("failed")
    expect(calls).toHaveLength(0)
    expect(notion.pages.create).not.toHaveBeenCalled()
  })
})

describe("createNotionAction: live write (mocked Notion)", () => {
  it("logs first, creates once, updates the log, upserts the mirror, links the check, then notifies", async () => {
    const { db, calls } = fakeDb()
    const notion = fakeNotion()
    const notifySlack = vi.fn(async () => {})
    const res = await createNotionAction({ db, notion, env: env({ writesEnabled: true, dryRun: false }), notifySlack }, input)

    expect(res.status).toBe("created")
    expect(notion.pages.create).toHaveBeenCalledTimes(1)
    expect(calls.map((c) => `${c.table}.${c.op}`)).toEqual([
      "notion_write_log.insert",
      "notion_write_log.update",
      "notion_pages_mirror.upsert",
      "check_results.update",
    ])
    expect((calls[0].args[0] as { dry_run: boolean }).dry_run).toBe(false)
    expect(calls[1].args[0]).toMatchObject({ success: true, response: { id: "page-1" } })
    expect(calls[2].args[0]).toMatchObject({ notion_page_id: "page-1", client_id: "client-camber", page_type: "action", created_by_app: true })
    expect(calls[3].args).toEqual([{ notion_action_page_id: "page-1" }, "id", "result-1"])
    expect(notifySlack).toHaveBeenCalledWith(expect.stringContaining("https://app.notion.com/p/page-1"))
  })

  it("sends exactly the confirmed properties and existing options", async () => {
    const { db } = fakeDb()
    const notion = fakeNotion()
    await createNotionAction({ db, notion, env: env({ writesEnabled: true, dryRun: false }) }, input)
    const sent = (notion.pages.create.mock.calls[0] as unknown[])[0] as { parent: unknown; properties: Record<string, unknown> }
    expect(sent.parent).toEqual({ data_source_id: "ds-master" })
    expect(Object.keys(sent.properties).sort()).toEqual(
      ["Brief Submitted by", "Client", "Date of Brief - Completion of Project", "Description of Request", "Master Status", "Production Type", "Project", "Project Lead", "QA Document"].sort(),
    )
    expect(sent.properties["Client"]).toEqual({ select: { name: "Camber" } })
    expect(sent.properties["Project Lead"]).toEqual({ people: [{ id: "notion-andrea" }] })
    expect(sent.properties["Master Status"]).toEqual({ status: { name: "New" } })
    expect(sent.properties["Production Type"]).toEqual({ select: { name: "Paid Media" } })
    expect(sent.properties["Date of Brief - Completion of Project"]).toEqual({ date: { start: "2026-10-05" } })
    expect(sent.properties["Brief Submitted by"]).toEqual({ rich_text: [{ type: "text", text: { content: "B&B Ops app · Dean Steinhobel" } }] })
    expect(sent.properties["QA Document"]).toEqual({ url: "http://localhost:3000/clients/camber/checks?result=result-1" })
  })

  it("splits long findings into Notion's 2,000-character text pieces", async () => {
    const { db } = fakeDb()
    const notion = fakeNotion()
    await createNotionAction({ db, notion, env: env({ writesEnabled: true, dryRun: false }) }, { ...input, description: "x".repeat(4500) })
    const sent = (notion.pages.create.mock.calls[0] as unknown[])[0] as { properties: Record<string, { rich_text: { text: { content: string } }[] }> }
    expect(sent.properties["Description of Request"].rich_text.map((t) => t.text.content.length)).toEqual([2000, 2000, 500])
  })

  it("records a Notion failure in the log and doesn't touch the mirror or the check", async () => {
    const { db, calls } = fakeDb()
    const res = await createNotionAction({ db, notion: fakeNotion(true), env: env({ writesEnabled: true, dryRun: false }) }, input)
    expect(res.status).toBe("failed")
    expect(calls.map((c) => `${c.table}.${c.op}`)).toEqual(["notion_write_log.insert", "notion_write_log.update"])
    expect(calls[1].args[0]).toMatchObject({ success: false, response: { error: "validation_error" } })
  })

  it("briefs a sprint test: logs it as create_test_brief and links the page to the test, not a check", async () => {
    const { db, calls } = fakeDb()
    const notion = fakeNotion()
    const res = await createNotionAction(
      { db, notion, env: env({ writesEnabled: true, dryRun: false }) },
      { ...input, checkResultId: null, sprintTestId: "test-1", appLink: "/clients/camber/sprint#test-test-1" },
    )
    expect(res.status).toBe("created")
    expect(calls[0].args[0]).toMatchObject({ operation: "create_test_brief", sprint_test_id: "test-1", check_result_id: null })
    expect(calls.map((c) => `${c.table}.${c.op}`)).toEqual(["notion_write_log.insert", "notion_write_log.update", "notion_pages_mirror.upsert", "sprint_tests.update"])
    expect(calls[3].args).toEqual([expect.objectContaining({ notion_page_id: "page-1", status: "briefed" }), "id", "test-1"])
    const sent = (notion.pages.create.mock.calls[0] as unknown[])[0] as { properties: Record<string, unknown> }
    expect(sent.properties["QA Document"]).toEqual({ url: "http://localhost:3000/clients/camber/sprint#test-test-1" })
  })

  it("a test brief in dry run changes nothing on the test", async () => {
    const { db, calls } = fakeDb()
    const res = await createNotionAction({ db, notion: fakeNotion(), env: env() }, { ...input, checkResultId: null, sprintTestId: "test-1" })
    expect(res.status).toBe("dry_run")
    expect(calls.map((c) => `${c.table}.${c.op}`)).toEqual(["notion_write_log.insert", "notion_write_log.update"])
    expect(calls[0].args[0]).toMatchObject({ operation: "create_test_brief", dry_run: true })
  })

  it("still reports success if Slack fails", async () => {
    const { db } = fakeDb()
    const res = await createNotionAction(
      { db, notion: fakeNotion(), env: env({ writesEnabled: true, dryRun: false }), notifySlack: async () => Promise.reject(new Error("slack down")) },
      input,
    )
    expect(res.status).toBe("created")
  })
})

describe("createNotionAction: test briefs with a comment (Dean, 2026-09-30)", () => {
  const brief: ActionInput = {
    ...input,
    checkResultId: null,
    sprintTestId: "test-1",
    coLeadIds: ["notion-kieran", "notion-andrea"],
    priority: "Medium",
    comment: { text: "We've seen good results from education on Google.\n\nCc @Kieran Carmon", mentions: [{ id: "notion-ash", name: "Ashleigh Clack" }, { id: "notion-kieran", name: "Kieran Carmon" }] },
  }
  const withComments = (fail = false) => {
    const n = fakeNotion()
    return { ...n, comments: { create: vi.fn(async () => (fail ? Promise.reject(new Error("restricted_resource")) : { id: "comment-1" })) } }
  }

  it("names it Lumaux | Paid Media | {test}, sets Status Content to Ready for Copy, priority and every project lead", async () => {
    const { db } = fakeDb()
    const notion = withComments()
    await createNotionAction({ db, notion, env: env({ writesEnabled: true, dryRun: false }) }, brief)
    const sent = (notion.pages.create.mock.calls[0] as unknown[])[0] as { properties: Record<string, unknown> }
    expect(sent.properties["Project"]).toEqual({ title: [{ type: "text", text: { content: "Lumaux | Paid Media | Camber: Meta overspend" } }] })
    expect(sent.properties["Status Content"]).toEqual({ select: { name: "Ready for Copy" } })
    expect(sent.properties["Priority"]).toEqual({ select: { name: "Medium" } })
    expect(sent.properties["Project Lead"]).toEqual({ people: [{ id: "notion-andrea" }, { id: "notion-kieran" }] })
  })

  it("comments on the new page only, logged before the call, with tagged people as mentions", async () => {
    const { db, calls } = fakeDb()
    const notion = withComments()
    const res = await createNotionAction({ db, notion, env: env({ writesEnabled: true, dryRun: false }) }, brief)
    expect(res.status).toBe("created")
    expect(calls.map((c) => `${c.table}.${c.op}`)).toEqual([
      "notion_write_log.insert",
      "notion_write_log.update",
      "notion_pages_mirror.upsert",
      "sprint_tests.update",
      "notion_write_log.insert",
      "notion_write_log.update",
    ])
    expect(calls[4].args[0]).toMatchObject({ operation: "create_comment", endpoint: "POST /v1/comments", dry_run: false })
    const sent = (notion.comments.create.mock.calls[0] as unknown[])[0] as { parent: unknown; rich_text: unknown[] }
    expect(sent.parent).toEqual({ page_id: "page-1" })
    // Ashleigh isn't named in the text, so she's greeted; Kieran is named, so he's mentioned in place.
    expect(sent.rich_text).toEqual([
      { type: "text", text: { content: "Hey " } },
      { type: "mention", mention: { user: { id: "notion-ash" } } },
      { type: "text", text: { content: "\n\nWe've seen good results from education on Google.\n\nCc " } },
      { type: "mention", mention: { user: { id: "notion-kieran" } } },
    ])
    expect(res.status === "created" && res.comment?.status).toBe("created")
  })

  it("keeps the page if the comment fails, and says so", async () => {
    const { db, calls } = fakeDb()
    const res = await createNotionAction({ db, notion: withComments(true), env: env({ writesEnabled: true, dryRun: false }) }, brief)
    expect(res.status).toBe("created")
    expect(res.status === "created" && res.comment).toMatchObject({ status: "failed", error: "restricted_resource" })
    expect(calls.at(-1)!.args[0]).toMatchObject({ success: false })
  })

  it("dry run: logs the page and the comment, calls nothing", async () => {
    const { db, calls } = fakeDb()
    const notion = withComments()
    const res = await createNotionAction({ db, notion, env: env() }, brief)
    expect(res.status).toBe("dry_run")
    expect(notion.pages.create).not.toHaveBeenCalled()
    expect(notion.comments.create).not.toHaveBeenCalled()
    expect(calls.map((c) => `${c.table}.${c.op}`)).toEqual(["notion_write_log.insert", "notion_write_log.update", "notion_write_log.insert", "notion_write_log.update"])
    expect(calls[2].args[0]).toMatchObject({ operation: "create_comment", dry_run: true })
  })

  it("NOTION_LIVE_CLIENTS: a client not on the list stays a dry run with both switches on", async () => {
    const { db } = fakeDb()
    const notion = withComments()
    const res = await createNotionAction({ db, notion, env: env({ writesEnabled: true, dryRun: false, liveClients: ["dnsfilter"] }) }, brief)
    expect(res.status).toBe("dry_run")
    expect(notion.pages.create).not.toHaveBeenCalled()
    expect(notion.comments.create).not.toHaveBeenCalled()
  })

  it("NOTION_LIVE_CLIENTS: a client on the list is written", async () => {
    const { db } = fakeDb()
    const notion = withComments()
    const res = await createNotionAction(
      { db, notion, env: env({ writesEnabled: true, dryRun: false, liveClients: ["dnsfilter"] }) },
      { ...brief, client: { id: "client-dnsf", slug: "dnsfilter", notion_client_option: "DNSFilter" } },
    )
    expect(res.status).toBe("created")
    expect(notion.comments.create).toHaveBeenCalledTimes(1)
  })

  it("an empty comment sends no comment", async () => {
    const { db, calls } = fakeDb()
    const notion = withComments()
    await createNotionAction({ db, notion, env: env({ writesEnabled: true, dryRun: false }) }, { ...brief, comment: { text: "  ", mentions: [] } })
    expect(notion.comments.create).not.toHaveBeenCalled()
    expect(calls.filter((c) => c.op === "insert")).toHaveLength(1)
  })
})
