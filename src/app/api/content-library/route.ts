import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import { z } from "zod"
import { canEdit, getProfile, VIEW_ONLY } from "@/lib/auth"
import { aiConfigured } from "@/lib/ai/claude"
import { suggestPlacement, suggestSequence, signSuggestion, writeAngle } from "@/lib/content-library/claude"
import { libraryConfig } from "@/lib/content-library/config"
import { readClientPage } from "@/lib/content-library/read-page"
import { forPrompt, libraryFor, newCode, saveRepick } from "@/lib/content-library/server"
import { briefForPrompt } from "@/lib/knowledge/brief"
import { rateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

// A placement reads the whole library and takes 20-60 seconds; the dialog waits for it.
export const maxDuration = 120

const Slot = z.union([z.literal(1), z.literal(2), z.literal(3)])
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read_page"), clientSlug: z.string().min(1).max(100), url: z.string().max(2000) }),
  z.object({
    action: z.literal("suggest"),
    clientSlug: z.string().min(1).max(100),
    piece: z.object({
      title: z.string().trim().min(1).max(300),
      url: z.string().max(2000).nullable(),
      type: z.string().min(1).max(60),
      audiences: z.array(z.string().max(60)).max(10),
      notes: z.string().max(5000),
      pageDescription: z.string().max(1000).optional(),
      pageText: z.string().max(15_000).optional(),
    }),
  }),
  z.object({ action: z.literal("reask"), clientSlug: z.string().min(1).max(100), pieceId: z.string().uuid() }),
  z.object({ action: z.literal("angle"), clientSlug: z.string().min(1).max(100), pieceId: z.string().uuid(), slot: Slot }),
])

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

/**
 * Claude and "Read page" for the content library (Plan › Content library). The client's team only
 * (not viewers); every action is rate limited. Reads go through the person's own Supabase client, so
 * RLS decides what they can reach; Claude's picks and angles are saved with the admin client after
 * that check, because Claude's pick is server-only.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return fail("Something's missing from that request.")
  const body = parsed.data
  const me = await getProfile()
  if (!canEdit(me)) return fail(VIEW_ONLY, 403)
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug").eq("slug", body.clientSlug).maybeSingle()
  if (!client) return fail("This client isn't available to you.", 404)
  const cfg = libraryConfig(client.slug)
  if (!cfg) return fail("This client has no content library.", 404)

  if (body.action === "read_page") {
    const limited = await rateLimit(supabase, "content_page_read")
    if (limited) return fail(limited, 429)
    try {
      return NextResponse.json({ page: await readClientPage(cfg, body.url.trim()) })
    } catch (e) {
      return fail((e as Error).message, 422)
    }
  }

  if (!aiConfigured()) return fail("Claude isn't set up on this server (ANTHROPIC_API_KEY).", 503)
  const { pieces, idOf } = await libraryFor(supabase, client.id)
  const { library, sequences } = forPrompt(pieces)

  try {
    if (body.action === "suggest") {
      const limited = await rateLimit(supabase, "content_placement")
      if (limited) return fail(limited, 429)
      const code = await newCode(client.id)
      const placement = await suggestPlacement({
        cfg,
        brief: await briefForPrompt(client.id),
        library,
        sequences,
        piece: { code, ...body.piece, url: body.piece.url || null, audiences: body.piece.audiences.filter((a) => cfg.audiences.includes(a)) },
        signal: request.signal,
      })
      return NextResponse.json({ code, placement, signed: signSuggestion(client.id, placement) })
    }

    const piece = pieces.find((p) => p.id === body.pieceId)
    if (!piece) return fail("That piece isn't in this client's library.", 404)

    if (body.action === "reask") {
      const limited = await rateLimit(supabase, "content_placement")
      if (limited) return fail(limited, 429)
      const picks = await suggestSequence({ cfg, brief: await briefForPrompt(client.id), library, sequences, code: piece.code })
      const result = await saveRepick(client.id, piece, picks, idOf, me.id)
      revalidatePath(`/clients/${client.slug}/library`)
      return NextResponse.json(result)
    }

    // action === "angle": for what the email sends now (read from the database, not the browser).
    const email = piece.emails.find((e) => e.slot === body.slot)!
    const target = email.handoff ? "handoff" : email.targetId ? pieces.find((p) => p.id === email.targetId) : null
    if (!target) return fail("Pick what this email sends first.")
    const limited = await rateLimit(supabase, "content_angle")
    if (limited) return fail(limited, 429)
    const asPrompt = (code: string) => library.find((p) => p.code === code)!
    const earlier = piece.emails
      .filter((e) => e.slot < body.slot)
      .map((e) => (e.handoff ? "the sales handoff" : e.targetId ? (pieces.find((p) => p.id === e.targetId)?.title ?? "") : ""))
      .filter(Boolean)
    const angle = await writeAngle({ cfg, engaged: asPrompt(piece.code), slot: body.slot, earlier, target: target === "handoff" ? "handoff" : asPrompt(target.code) })
    // Still Claude's piece: the new angle becomes Claude's too, so the email stays "Claude's pick".
    const sameAsClaude = email.suggested && email.suggested.targetId === email.targetId && email.suggested.handoff === email.handoff
    const { error } = await createAdminClient(me?.id)
      .from("content_sequences")
      .update({ angle, updated_by_profile_id: me.id, ...(sameAsClaude ? { suggested_angle: angle, suggested_at: new Date().toISOString() } : {}) })
      .eq("piece_id", piece.id)
      .eq("slot", body.slot)
      .eq("client_id", client.id)
    if (error) throw new Error(error.message)
    revalidatePath(`/clients/${client.slug}/library`)
    return NextResponse.json({ angle })
  } catch (e) {
    if (request.signal.aborted) return fail("Stopped.", 499)
    console.error("content library claude failed", e)
    return fail("Claude couldn't do that just now. Try again in a minute.", 502)
  }
}
