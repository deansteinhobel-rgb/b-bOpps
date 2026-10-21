/**
 * LinkedIn's errors in plain words (Dean, 2026-10-21: "let us know what the error means"): what
 * happened, whether anything changed, and what to do. The raw status and LinkedIn's own message stay
 * in brackets at the end for whoever debugs it. A plain module so the tests and the UI can use it.
 */
export function explainLinkedIn(status: number, raw?: string | null): string {
  const said = raw?.trim() ? ` (LinkedIn ${status}: ${raw.trim().slice(0, 200)})` : ` (LinkedIn ${status})`
  if (status === 401) return `LinkedIn's sign-in for Lumaux has expired or was revoked. Nothing was changed. An admin reconnects it with pnpm ads:connect linkedin.${said}`
  if (status === 403) return `The LinkedIn login connected to Lumaux isn't allowed to change this ad account. Nothing was changed. It needs Account Manager or Campaign Manager on the account in Campaign Manager › Account settings › Manage access.${said}`
  if (status === 404) return `LinkedIn can't find this campaign any more (it may have been removed or moved). Nothing was changed.${said}`
  if (status === 409 || status === 412) return `The campaign changed in LinkedIn while Lumaux was working on it. Nothing was changed. Open it again and retry.${said}`
  if (status === 414 || status === 431) return `The campaign's targeting is too large to send in one request. Nothing was changed.${said}`
  if (status === 422) return `LinkedIn refused the change, so nothing was changed. Usually a setting on the campaign doesn't allow it; LinkedIn's reason is in brackets.${said}`
  if (status === 429) return `LinkedIn is limiting how fast Lumaux can make changes. Nothing was changed. Wait a minute and try again.${said}`
  if (status === 400) return `LinkedIn didn't accept the request, so nothing was changed. Lumaux sent something in a shape LinkedIn doesn't take; tell Dean with the details in brackets.${said}`
  if (status >= 500) return `LinkedIn had a problem on its side. The change may or may not have gone through: check the campaign in Campaign Manager before trying again.${said}`
  return `LinkedIn answered with an unexpected error. Check the campaign in Campaign Manager before trying again.${said}`
}

/** For a step that only reads (the targeting, an audience size): nothing can have changed. */
export const explainLinkedInRead = (status: number, raw?: string | null) =>
  status >= 500 ? `LinkedIn had a problem on its side, so Lumaux couldn't read the campaign. Nothing was changed. Try again in a minute. (LinkedIn ${status}${raw ? `: ${raw.slice(0, 200)}` : ""})` : explainLinkedIn(status, raw)
