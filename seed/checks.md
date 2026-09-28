# QA check definitions (DRAFT: please edit)

This file is the source for the app's checks. Edit the wording freely. Keep the headings and the
`Field:` labels as they are, because the seed script reads them.

- **Owner:** the paid media specialist (Andrea) runs the checks by default. Change a check's `Owner:` to `AM` or `GTM lead` if someone else should own it.
- **Pre-loaded:** numbers the app fills in from Windsor before you start, so you don't have to look them up.
- **Status:** always one of Green, Amber, Red or N/A. Thresholds below are suggestions to edit.
- **Red:** a Red status offers a "Create action in Notion" button, pre-filled from your findings.

---

## Weekly

### leads_in_crm: Leads in CRM
- Cadence: weekly
- Owner: Specialist
- Pre-loaded: leads and conversions per platform for the last 7 days (from Windsor). HubSpot lead counts come in a later phase.
- Instructions: In HubSpot, filter contacts created in the last 7 days whose original source is paid social or paid search. Compare the count with the platform totals shown above. Open three or four recent paid leads and check that source, campaign and UTM fields are filled in.
- What to record: the HubSpot paid lead count, the platform count, the gap as a %, and any leads with missing source or campaign data.
- Not applicable when: no lead-generation or conversion campaigns were live this week.
- Flag immediately when: platforms report leads but none arrived in HubSpot, or lead form or CRM sync errors appear.
- Guide: Green = gap within 15%. Amber = 15–30%, or some leads missing attribution. Red = gap over 30%, or zero leads in CRM.

### budget_pacing: Budget pacing
- Cadence: weekly
- Owner: Specialist
- Pre-loaded: spend month-to-date against this month's budget for each platform, pacing %, and the last two days of spend.
- Instructions: Check the pacing figures above against the plan. If a platform is off pace, look at which campaigns are driving it in the platform UI and decide whether to adjust daily budgets. If the variance is intentional (for example, leftover quarterly budget being spent), say so.
- What to record: pacing % per platform, the reason for any variance, and any budget changes made.
- Not applicable when: the client has no paid budget this month.
- Flag immediately when: overspend is more than 20% above pace, or spend is zero for two days while a budget is set.
- Guide: Green = within ±10% of pace. Amber = outside ±10%. Red = over 20% above pace, or zero spend for two days.

### landing_pages: Landing pages, tags and forms
- Cadence: weekly
- Owner: Specialist
- Pre-loaded: none.
- Instructions: For every landing page receiving paid traffic:
  1. Check the page loads on desktop and mobile.
  2. Submit the form once with a clearly marked test entry, then delete or mark the test contact in HubSpot.
  3. Check the thank-you step fires the conversion. Use Google Tag Assistant, the Meta Pixel Helper and LinkedIn Insight Tag checks.
  4. Check the page copy still matches the live ads.
- What to record: the pages checked, and anything broken: page, form, tag or copy mismatch.
- Not applicable when: no paid traffic goes to landing pages (for example, lead-form-only campaigns).
- Flag immediately when: a page with live spend is down, the form fails to submit, or the conversion tag doesn't fire.
- Guide: Green = all working. Amber = minor issues (copy, speed). Red = broken form, page or conversion tracking.

### ad_fatigue: Ad fatigue
- Cadence: weekly
- Owner: Specialist
- Pre-loaded: live ads first seen 45 or more days ago, with CTR over the last 7 days against their first 14 days. Windsor can't see creative edits, so age is based on the first date each ad appeared.
- Instructions: Review the list above. For each old ad, compare its recent CTR with its early CTR, and on Meta also check frequency. Decide which ads to refresh or rotate out.
- What to record: which ads are fatigued, and the refresh plan, owner and date.
- Not applicable when: there are no live ads older than 45 days.
- Flag immediately when: most spend is going to fatigued ads with CTR down more than 30%.
- Guide: Green = no fatigued ads, or refreshes already planned. Amber = fatigued ads with no plan yet. Red = most spend on fatigued ads and CTR down more than 30%.

### naming_spot_check: Naming structure spot check
- Cadence: weekly
- Owner: Specialist
- Pre-loaded: campaigns and ads first seen this week (names from Windsor).
- Instructions: Check five of the new campaigns or ads against the B&B naming convention. On LinkedIn and Meta that's currently `Audience | Offer | Format | Objective`. On Google it's `SEM-{Type}-{Theme}`. Check segment order, separators and spelling.
- What to record: the names checked, and any that break the convention, with the corrected name.
- Not applicable when: nothing new launched this week.
- Flag immediately when: never. Naming issues aren't urgent on their own.
- Guide: Green = all correct. Amber = one or two wrong. Red = the convention isn't being followed at all.

### utm_spot_check: UTM consistency spot check
- Cadence: weekly
- Owner: Specialist
- Pre-loaded: none. Windsor doesn't return final URLs, so check in the platform.
- Instructions: Open the final URLs of five live ads across platforms. Check `utm_source`, `utm_medium` and `utm_campaign` are all present and lowercase, follow the B&B UTM convention, and that `utm_campaign` matches the campaign.
- What to record: the ads checked and any wrong or missing UTMs.
- Not applicable when: there are no live ads with website destinations.
- Flag immediately when: a live ad with meaningful spend has no UTMs, because its leads will be unattributed.
- Guide: Green = all correct. Amber = inconsistent but present. Red = missing on a live ad.

### best_ad: Best performing ad
- Cadence: weekly
- Owner: Specialist
- Pre-loaded: the best ad over the last 7 days, by cost per conversion where it has 3 or more conversions, otherwise by CTR. Only ads above the account's median ad spend are included.
- Instructions: Look at why this ad is winning: audience, message, format and offer. Decide whether to scale it (more budget or new variants) and whether the idea should carry over to other platforms.
- What to record: why it's working and the action (scale, replicate, test variants).
- Not applicable when: too little spend this week to judge (no ad above the median spend).
- Flag immediately when: never.
- Guide: Green = insight recorded and action decided. Amber = no clear winner. Red isn't normally used.

### worst_ad: Worst performing ad
- Cadence: weekly
- Owner: Specialist
- Pre-loaded: the worst ad over the last 7 days, by the same rule as the best ad.
- Instructions: Look at why this ad is underperforming. Decide whether to pause, refresh or keep it (and say why if you keep it).
- What to record: the diagnosis and the decision.
- Not applicable when: too little spend this week to judge.
- Flag immediately when: a single ad is burning more than 20% of weekly spend with no conversions.
- Guide: Green = decision made. Amber = keeping a poor ad for a stated reason. Red = heavy wasted spend with no action.

### google_search_terms: Google search terms and placements
- Cadence: weekly
- Owner: Specialist
- Pre-loaded: Google spend, clicks and conversions for the last 7 days.
- Instructions: In Google Ads, review the search terms report for the last 7 days. Add irrelevant terms as negatives. For Display and PMax, review placements and exclude junk apps and sites. Check brand terms aren't leaking into non-brand campaigns.
- What to record: the negatives added, placements excluded, and the estimated wasted spend.
- Not applicable when: no Google Search, Display or PMax campaigns are live.
- Flag immediately when: more than 15% of spend is going to clearly irrelevant terms or placements.
- Guide: Green = clean, or tidied up. Amber = wasted spend of 5–15%. Red = over 15%.

### linkedin_audience: LinkedIn companies and job titles
- Cadence: weekly
- Owner: Specialist
- Pre-loaded: LinkedIn spend, impressions and clicks for the last 7 days.
- Instructions: In LinkedIn Campaign Manager, open Demographics for the last 7 days: company, job title, seniority and industry. Check the audience matches the ICP or ABM list. Exclude competitors, students, job seekers and irrelevant functions.
- What to record: the share of impressions that is on target, the exclusions made, and any ABM accounts engaging well.
- Not applicable when: no LinkedIn campaigns are live.
- Flag immediately when: more than 30% of impressions are clearly outside the target audience.
- Guide: Green = on target. Amber = some drift, tidied up. Red = over 30% off target.

---

## Monthly

### new_creatives: New creatives this month
- Cadence: monthly
- Owner: Specialist
- Pre-loaded: ads first seen this calendar month, per platform.
- Instructions: Compare the new creatives launched with the creative plan and with the ad fatigue findings. Check each new creative went through proofing and approval (Notion status).
- What to record: the number launched against plan, what's missing, and when it will launch.
- Not applicable when: no creative refresh was planned this month.
- Flag immediately when: never.
- Guide: Green = on plan. Amber = behind plan. Red = no new creative while ad fatigue is flagged.

### naming_full_review: Naming structure full review
- Cadence: monthly
- Owner: Specialist
- Pre-loaded: all campaigns and ads with spend this month (names from Windsor).
- Instructions: Check every active campaign, ad group and ad against the naming convention, and rename or log anything that breaks it.
- What to record: the number checked, the number fixed, and anything left to fix.
- Not applicable when: there was no activity this month.
- Flag immediately when: never.
- Guide: Green = all compliant. Amber = fewer than 10% wrong. Red = 10% or more wrong.

### utm_full_review: UTM consistency full review
- Cadence: monthly
- Owner: Specialist
- Pre-loaded: none.
- Instructions: Check the UTMs on every live ad. In HubSpot, check this month's paid leads are attributed to the right source and campaign, with no "offline" or "direct" leaks from paid traffic.
- What to record: the ads checked, the fixes made, and the attribution gaps found in HubSpot.
- Not applicable when: there were no live ads with website destinations.
- Flag immediately when: paid leads are showing up as direct or offline in HubSpot at scale.
- Guide: Green = clean. Amber = minor gaps. Red = systematic attribution loss.

### kpi_vs_target: KPI status vs target
- Cadence: monthly
- Owner: Specialist
- Pre-loaded: cost per result (spend ÷ conversions + leads) month-to-date, per platform and blended, against the client's target. The previous month is shown too, for trend.
- Instructions: Review performance against the target. Explain what's driving it, and what will change next month. Write it plainly: the AM will use this with the client.
- What to record: a short summary for the AM, the drivers, and next month's changes.
- Not applicable when: never (there is always a target).
- Flag immediately when: blended cost per result is more than 50% over target.
- Guide: Green = at or under target. Amber = up to 20% over. Red = more than 20% over.
