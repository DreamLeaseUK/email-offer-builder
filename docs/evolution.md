# DreamLease Offer Mailer — evolution plan (multi-year)

**Status: decided by Matt on 29 September 2026, after the demo. Phase 1 is built on branch `feat/phase1-send-m365` (session 10, 29 Sept; not yet deployed): §6 records it as built.**
Requirements come from Matt's interview the same afternoon. This document is the plan; `docs/architecture.md` stays
the description of what exists, and is updated as each phase ships.

## 1. Why the plan changed

At the demo (29 Sept) the email broke. Most salespeople use **Outlook classic**, and the only send route was *Copy for
Outlook*: paste the email into a new Outlook message and send it. Classic Outlook edits a pasted email with Word, which
rewrites the layout. No change to the email's markup can survive being pasted into Word, so the **route** has to
change, not the markup.

## 2. Requirements (Matt, 29 Sept)

| Area | Requirement |
|---|---|
| Sending | The salesperson presses **Send in the tool**. It is sent **from their own mailbox** through Microsoft 365, lands in their Sent Items, and replies come to them. |
| Reliability | Salespeople never test emails. The design is certified once per release; the tool checks every email automatically and refuses to send a faulty one. |
| Customer record | **monday.com** (Pro or Enterprise) holds the leads: name and email, vehicle interest and budget, contract end date, assigned salesperson, and per-lead marketing consent. |
| Start point | A **"Send offers" button on the monday.com lead** opens the tool with the customer filled in (the tool can also start on its own). |
| Back to monday.com | The sent email and its offers; opens and clicks per customer; web enquiries that came from the email; replies. Follow-up reminders. |
| Email types | One-to-one offers first; then renewal reminders (from contract end dates), quote follow-ups, employer offer packs, bulk campaigns. |
| Bulk | Split by size: up to about 50 recipients from the salesperson's mailbox via Microsoft 365; larger lists through a marketing platform (Mautic) with unsubscribe and consent handling. *Phase 1 decision (Matt, 29 Sept): one customer per email from the salesperson's mailbox, as rule 4 says; any bulk goes through Mautic (Phase 4).* |
| Readers | Must display correctly in **Outlook classic**, new Outlook and Outlook on the web, Gmail (web and app), and Apple Mail / iPhone. |
| Compliance | Emma approves the legal wording only (as now). |
| Brands | DreamLease now. SalSac is a future iteration, added as configuration, not a rebuild. |
| Scale | Up to 10 salespeople, sending daily. |
| Pace | Usable fast, then grow, on the same foundations. |

## 3. Decisions (Matt, 29 Sept: "all as recommended")

1. **Rule 4 changes** from "drafts only, the Worker never sends" to: *the salesperson presses Send in the tool; the
   email is sent from their own mailbox via Microsoft 365; never automatically.* Until Phase 1 ships, delivery stays
   Copy for Outlook.
2. **Microsoft permission: "Connect Outlook" once per salesperson** (delegated `Mail.Send`), through a **second Entra
   app**, "DreamLease Offer Mailer - Send", separate from the sign-in app. IT grants admin consent once; each
   salesperson clicks Connect once. The tool can only ever send as the person who connected, and only when that is the
   person signed in. No Entra ID P1 licence and no group is needed. (Rejected: an app-wide "send as anyone" permission
   fenced by an Exchange management scope — more privilege, PowerShell for IT, more questions from security reviewers.)
3. **Open tracking only for leads with marketing consent** (UK PECR treats open-tracking pixels as needing consent).
   Clicks and online-page views are tracked for everyone.
4. **Certification, not per-email testing:** real test sends of a fixed set, opened in all four programs, before each
   release. A paid email-preview service only if problems keep recurring.
5. **Microsoft 365 for one-to-one; Mautic for bulk and automated journeys** (Phase 4). The tool builds the email once
   and hands it to whichever route fits.
6. **monday.com is the customer record, not the send route.** The earlier idea (24 Sept) of sending through
   monday.com's email tool is superseded.

### Why Microsoft 365 and not Mautic for one-to-one

| | Microsoft 365 (send as them) | Mautic |
|---|---|---|
| What the customer receives | A personal email from the salesperson's real mailbox | A marketing email (unsubscribe footer, tracking); Gmail tends to file it under Promotions |
| Salesperson's Outlook | In Sent Items; replies thread normally | Not in Sent Items; replies arrive without the original |
| Deliverability | Already set up for dreamlease.co.uk | New sending records in the GoDaddy DNS; its own reputation to build |
| Customer data | Nothing new | Every recipient copied into Mautic as a contact: another processor (GDPR) |
| Extra system | None | Mautic (hosting, updates) plus an email-sending service |

Mautic is the right tool for lists, unsubscribes, consent and automated sequences, and Microsoft limits bulk sending
from personal mailboxes; hence the split.

## 4. Target architecture

```
monday.com (customer record)            Microsoft 365 (one-to-one send, as the salesperson)
   │  "Send offers" button, lead data         ▲
   ▼                                          │ m365 output adapter (delegated Mail.Send)
Offer Mailer: compose · offers · brochures · render (certified design) · compliance lock · register · checks
   │  sent / clicks / enquiries / replies      │ mautic output adapter (Phase 4: bulk, journeys)
   ▼                                          ▼
monday.com (activity on the lead)          Mautic (lists, unsubscribes, consent)
```

The house pattern holds (`CLAUDE.md` rule 1, the operating model's Rule 3): the Zod model at the centre, one adapter per
outside system (`packages/adapters/src/m365/`, `monday/`, `mautic/`), no adapter importing another, one documented API
(`/api/openapi.json`), additive database changes only, contract tests at every seam. Everything built so far is reused:
offer lookup, Library, brochure finder, the v5 email design, compliance lock, promotions register, Microsoft sign-in.

## 5. Phases

| Phase | Salespeople get | Rough size | Depends on |
|---|---|---|---|
| **1. Send properly** | Connect Outlook once; **Send** in the tool, from their mailbox, after automatic checks; Copy for Outlook kept as a backup. The design certified in all four programs. | ~3 working days of build, IT's 20 minutes, one certification morning | IT: the Send app and consent |
| **2. monday.com loop** | "Send offers" button on the lead, pre-filled; sent email and offers logged on the lead; clicks per customer (opens with consent); follow-up reminders. | ~2 weeks | monday.com API token; the board and column map |
| **3. Renewals and follow-ups** | "Due for renewal" from contract end dates, with suggested offers; quote follow-ups; employer packs. | ~2 weeks | Phase 2 |
| **4. Bulk and brands** | Campaigns to a filtered monday.com list; large lists via Mautic with unsubscribe handling; SalSac as a brand setting. | ~2–3 weeks | Mautic hosting and sending records; consent data |

Web enquiries matched to the lead need MotorComplete's website to carry a reference into its enquiry form: a
dependency on them, slotted in whenever they can do it.

## 6. Phase 1 in detail — "Send properly"

**The salesperson's flow.**

1. Once: **Connect Outlook** (one click; they are already signed in with Microsoft).
2. Compose as today → **Create campaign** → enter the customer's email → **Send**.
3. The tool runs its checks; if all pass it sends through Microsoft 365 and says "Sent from your mailbox at 10:42".
   The email is in their Sent Items; replies come to them. Copy for Outlook stays as a backup, not the main route.

**Automatic checks before every send** (a failed check blocks the send and says what to fix):

- The compliance template is **approved by compliance** (not the placeholder, which has no approver).
- Every offer is priced, and still valid (not past its `validUntil`); each offer link still opens that offer (not an
  ended offer redirected to a listing).
- Every image and brochure link in the email answers.
- The recipient's address is valid and **not on the suppression list**.
- Subject and intro are present; the message is under Microsoft's size limit; no CAP ID (rule 2).

**Decisions taken before the build (Matt, 29 Sept, session 10: "go", "yes" to all).**

1. One customer per email, one send per campaign; only the person who created the campaign can send it, from their
   own mailbox. To send the same offers to someone else, create the campaign again.
2. Offer check at Send: an offer looked up within the last 24 hours counts as checked (`config/mail.json`); an older
   one is looked up again (up to one Firecrawl credit each, only when the direct fetch is refused). An ended, unpriced
   or out-of-date offer, or one whose website price has changed, blocks the send.
3. Copy for Outlook runs the same checks before copying (all but the customer's address), so the backup cannot be used
   to get round them.
4. SalSac staff are left for a later iteration: Connect Outlook and Send are for dreamlease.co.uk addresses only
   (`config/mail.json`); SalSac staff keep Copy for Outlook. Nothing about salsac.co.uk in IT's Part D.
5. Security: the full checks run, and the part-time developer gets a short review pack before the deploy.
6. A 12-month client secret, not a certificate (as for the sign-in app); if IT's policy blocks secrets, switch.

**Dependencies found in the hand-over check (29 Sept).** (a) **Emma publishes the approved wording** for all three
contract types: the Send check refuses the placeholder, so no real send, not even the local proof or the
certification morning, can pass before that. **Deploy only after she has**: Copy for Outlook now runs the same checks,
so on the placeholder it stops too (found by the code review, 29 Sept). (b) **Matt applies the new table to production** (`pnpm db:migrate`)
before the first local test send (`dev:live` uses production D1) and before the deploy; the deploy does not migrate.
(c) IT's CNAME for offers.dreamlease.co.uk should exist before the first real customer email (links to workers.dev
may be caught by spam filters).

**What changed in the code** (as built, one PR, contract-tested):

- `packages/adapters/src/m365/`: the `m365` `OfferOutput` (the existing interface, now taking the one recipient) and a
  Microsoft client: authorization code + PKCE against the tenant's own endpoints, token refresh (Microsoft rotates the
  refresh token on every use; the new one is always stored), `GET /me` to confirm whose mailbox it is, and
  `POST /me/sendMail` (HTML body, `saveToSentItems: true`, never a `from`). Microsoft's answers map to five outcomes
  the tool acts on (reconnect, app credential, throttled, rejected, unavailable). I/O injected; contract tests against a
  stand-in for Microsoft.
- `apps/api`: `/api/mail/status`, `/connect`, `/callback`, `/disconnect` (`mail.ts`); `/api/campaigns/{id}/checks` and
  `/send` (`send.ts`); the checks themselves (`presend.ts`, pure, tested rule by rule); all in `OPERATIONS` / OpenAPI.
  The connected account must be the Access-verified user, checked at connect and again at every send. The return
  address is configuration (`MAIL_REDIRECT_URI`), never taken from the request: `pnpm dev` and `dev:live` pass the
  localhost one. The email is **re-rendered on the server** from the stored campaign and its own template, never taken
  from the browser. A send reserves the campaign first, so a double click cannot send it twice.
- D1, additive: migration `0004_mail_connections` (email, the encrypted refresh token, scopes, connected, updated, last
  sent). AES-GCM with the `MAIL_TOKEN_KEY` secret, bound to the owner's email; never logged. A permission Microsoft no
  longer honours, or one that cannot be opened (a changed key), is deleted and the salesperson is asked to connect
  again. The daily Cron deletes connections unused for 90 days.
- The campaign record: `sentAt` and `sentVia` existed; `sentVia` gains `'m365'` and `sentBy` is new (schema and a
  "Sent by" register column; no new D1 column). The recipient's address is used to send and not stored, as now.
- `apps/web`: Connect / Disconnect Outlook (Step 3, Your details), the customer's email and **Send** (Step 6, now
  called "Send"), "Sent from your mailbox at 10:42", failed checks listed in plain words; Copy for Outlook below as
  the backup, blocked with the same messages when a check fails.
- `CLAUDE.md` rule 4 rewritten as decided; runbook Part D with IT's steps.

**IT's part (runbook Part D, click by click, about 20 minutes).** A second Entra app registration "DreamLease Offer
Mailer - Send" (single tenant); redirect URIs `https://marketingtools.dreamelectric.uk/api/mail/callback` and
`http://localhost:5173/api/mail/callback` (for testing on Matt's PC); delegated Microsoft Graph permissions
`Mail.Send`, `offline_access`, `User.Read`, `openid`, `email`, with **admin consent**; a 12-month client secret given
to Matt by phone; the application ID sent by email. Optional: "Assignment required" with the salespeople assigned
individually.

**Matt's part.** Apply the new table to production (`pnpm db:migrate`); paste two secrets in the Terminal (IT's client
secret; an encryption key the command generates without showing it); send Claude the two IDs from IT (not secret, they
go in `wrangler.jsonc`); ship it; deploy; take part in the certification morning. After the local test send,
Disconnect Outlook, so no permission encrypted with the local key stays in production.

**Proof.**

1. Automated tests: sending against the Graph stand-in, token encryption, "only as yourself", every pre-send check,
   the register entry. Typecheck, build, `diff-reference`.
2. A real send from Matt's local copy before anything goes live.
3. **Certification:** a fixed set (one offer; three offers; PCH, BCH, salary sacrifice; with a brochure) sent to test
   mailboxes and opened in Outlook classic, new Outlook / web, Gmail (web and app) and iPhone Mail, against a checklist,
   with screenshots. Anything wrong is fixed in the email design before release (the diagnostic `.eml` method in
   `CLAUDE.md`, `diff-reference` discipline).

**Main risk.** The email's layout was tuned in September for the paste route: the style block and the Outlook-only
(`[if mso]`) parts were stripped, so three deviations were made (fluid wrapper, inline-block pills, calc()-fluid image
column; `cards.ts` header a–c). Sent directly, classic Outlook reads those Outlook-only parts for the first time, and
Word does not understand calc(). The certification exists to catch this; fixes go into the design before release.

**Cost.** Microsoft 365 sending is included in the licences; no new subscriptions in Phase 1.

## 7. Open questions for later phases

- Phase 2: the monday.com board(s), column names and the consent field; who creates the API token.
- Phase 2: whether MotorComplete can carry a reference through the website's enquiry form.
- Phase 4: Mautic — existing or new, hosted where, which sending service, and the DNS records it needs.
