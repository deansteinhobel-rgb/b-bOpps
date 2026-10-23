import { NextResponse } from "next/server"
import { z } from "zod"
import { getProfile } from "@/lib/auth"
import { briefBlocks, docxFileName } from "@/lib/campaign-brief/document"
import { briefDocx } from "@/lib/campaign-brief/docx"
import { brief as briefSchema } from "@/lib/campaign-brief/schema"
import { createClient } from "@/lib/supabase/server"

/** GET ?brief=<id>: the campaign brief as a Word file (Dean, 2026-10-23), read through RLS, so anyone on the client's team can download it. */
export async function GET(request: Request) {
  await getProfile()
  const briefId = new URL(request.url).searchParams.get("brief")
  if (!briefId || !z.uuid().safeParse(briefId).success) return NextResponse.json({ error: "Missing brief." }, { status: 400 })
  const supabase = await createClient()
  const { data: row } = await supabase.from("campaign_briefs").select("id, brief, created_at, clients(name, slug)").eq("id", briefId).maybeSingle()
  const parsed = briefSchema.safeParse(row?.brief)
  if (!row || !row.clients || !parsed.success) return NextResponse.json({ error: "Not found." }, { status: 404 })
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")
  const blocks = briefBlocks(parsed.data, { clientName: row.clients.name, createdOn: row.created_at.slice(0, 10), link: `${appUrl}/clients/${row.clients.slug}/campaign-brief?brief=${row.id}` })
  const file = await briefDocx(blocks)
  const name = docxFileName(row.clients.name, parsed.data.title)
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  })
}
