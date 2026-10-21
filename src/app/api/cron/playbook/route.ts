import { NextResponse, type NextRequest } from "next/server"
import { isCron } from "@/lib/cron-auth"
import { researchPlaybook, RESEARCH_PLATFORMS, type ResearchPlatform } from "@/lib/campaign-builder/research"

export const maxDuration = 300

/**
 * Monthly: the best practice research behind the campaign builder, one platform per run
 * (`?platform=linkedin`, the default), because one platform's research takes a few minutes.
 * Vercel cron runs LinkedIn on the 1st, Google Ads on the 2nd, Meta on the 3rd, Reddit on the 4th.
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  if (!isCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const asked = request.nextUrl.searchParams.get("platform") ?? "linkedin"
  if (!(RESEARCH_PLATFORMS as readonly string[]).includes(asked)) return NextResponse.json({ error: "unknown platform" }, { status: 400 })
  try {
    const id = await researchPlaybook(asked as ResearchPlatform)
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
