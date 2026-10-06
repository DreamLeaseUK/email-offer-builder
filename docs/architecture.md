# DreamLease Offer Mailer — Solution Design & System Architecture

**Status:** current as of 29 Sept 2026 (session 9: live behind sign-in, production v0.6.1; session 10: **Phase 1, the
Microsoft 365 send, built on branch `feat/phase1-send-m365` as v0.7.0, not yet deployed**, B13). **Forward plan:
`evolution.md`**: after the demo (29 Sept) the send route changes to Microsoft 365 from the salesperson's own
mailbox, with monday.com as the customer record and Mautic for bulk; this document is updated as each phase ships.
This is the authoritative technical design document. (Until 29 Sept this header said production was still v0.5.0;
everything of sessions 6–9 is deployed: `status-2026-09-29.md`.) For product
requirements see `dreamlease-offer-mailer-brief.md` (v1.1, with an as-built log in §9a); for the email-markup
reference see `offer-mailer-implementation-notes.md` (and the deviations from it in B7); for the build log see
`status-2026-09-28.md` (`-09-24`, `-09-23`, `-09-21`, `-09-18`, `-09-16`, `-09-15`, `-09-14` are history); for how to resume see
`PICKUP-PROMPT.md`; for sign-in set-up see `it-runbook-sign-in.md`. Brochure discovery (the finder) is designed and evidenced in `brochure-finder-brief.md`.
Where this document and the code disagree, the code wins — fix this document.

---

# Part A — Solution Design

## A1. What it is
An internal, FCA-aware tool. A DreamLease salesperson pastes a `dreamlease.co.uk` vehicle URL, assembles a
branded HTML email of one to six lease offers, and gets back **Outlook-ready HTML** (Copy-for-Outlook) plus a
**hosted web page** of the same offers. A human always presses Send: from Phase 1 (B13) the tool sends it from the salesperson's own mailbox after automatic checks; Copy for Outlook stays as a backup.

Three audiences / lease products, each with its own compliance wording and terms:
- **PCH** — personal contract hire (`personal`)
- **BCH** — business contract hire (`business`)
- **Salary sacrifice** (`salary_sacrifice`) — no initial payment; the price is all-in (finance + maintenance
  + insurance) and shown as two net figures (20% and 40% taxpayer).

## A2. Core flows
1. **Look up a vehicle.** Salesperson pastes a vehicle URL → normalise → HTMLRewriter page parse (identity/stats/
   image) → the site's own pricing JSON prices the chosen term/mileage/initial → returns an `Offer` plus the
   configuration options (the "chips"). Cached 24 h. Prices are not in the page HTML. The site HTML-encodes text
   even inside its script block ("Techno &#x2B; Comfort Range"), so names, stats and spec lines are entity-decoded;
   a cached result that still carries an entity is treated as stale. The same decoding runs again where an offer
   re-enters the server (library save and list, campaign preview and create), because a saved or open offer is a
   snapshot from before the fix (`packages/schema/src/text.ts`). **Special offers:** the pricing call sends the
   page's special-offer id as `offerId` (the price component's `offer-id`), as the page itself does; since early
   October 2026 the site answers POA or the ordinary, higher price without it (seen 6 Oct). Every looked-up offer is
   stamped `source.pricingVersion` (`PRICING_VERSION`, 2); a cached result from another version is stale, a draft
   restored with an offer priced the old way is re-priced, and the lookup warns when its price differs from the
   page's own published price (schema.org `lowPrice`) at the page's default terms. The **configured terms
   are encoded into the offer URL**, so "View offer" opens the site pre-set to exactly what was quoted.
2. **Configure & assemble.** Salesperson picks the audience and up to six offers, writes the intro/subject, picks
   the green-button CTA + optional secondary contact links, optionally attaches a brochure, previews live.
   There is no layout to choose: one offer is the hero card, two or more are one offer per row (B7).
3. **Create.** The server assembles a `Campaign` (server-owned identity/slug/tracking/template/compliance),
   strips any recipient PII, validates, renders, writes the hosted page to R2, stores a snapshot in D1, and
   returns the email HTML/text for Copy-for-Outlook plus the hosted URL.
4. **Deliver.** Copy-for-Outlook (clipboard `text/html` + `text/plain`), or the hosted link. The Outlook/Graph
   "create draft" was **removed from the plan** (24 Sept 2026). From Phase 1 (B13): **Send** from the salesperson's own mailbox via Microsoft 365, after the pre-send checks. A human sends. **The paste into New
   Outlook is the real send path today, and Outlook rewrites what is pasted** — see A5; the email is built for
   what survives it.
5. **Track.** Every http link routes through `/r/<slug>/<linkId>` (logs a click, redirects); hosted-page views
   are logged. Stats per campaign. **No IP, no full user-agent.** Every link back to dreamlease.co.uk also carries
   UTMs naming the tool, the campaign, the offer and — automatically, as `utm_term` — **the salesperson**, so a web
   enquiry started from the email is attributable to them in GA (B7, "Attribution").

## A3. Feature inventory (built)
- **Compose**: URL lookup → re-pricing chips → live preview → create → Copy-for-Outlook + hosted link. The
  first offer **auto-renders the preview**; later edits keep the preview visible but **flag it out-of-date**
  (the salesperson presses Update preview) rather than blanking it; the Add button stays enabled and reads "Add
  offer" / "Add another offer". Since 23 Sept there is **no preheader field** (the email's inbox preview is derived
  from the intro — B7) and the **recipient's first name sits above the intro**. The three Compose panels (Campaign,
  Offers, Preview) are **resizable**: two draggable dividers set the Campaign and Offers widths, the preview takes the
  rest, with minimum widths (260 / 300 / 300 px), the widths remembered per browser (`localStorage`
  `dl-compose-cols`), and the panels stacking with the dividers hidden below 1100 px.
- **Audience selector**: PCH / BCH / Salary sacrifice, driving compliance block, terms and (salsac) pricing.
- **Offer-button CTA**: one primary green button per campaign — *View offer · Call · WhatsApp · Email · Book a
  time to discuss* — each gated on the sender field it needs, with a salesperson-renamable label (≤30 chars).
- **Secondary contact links**: an optional salesperson-chosen row (*Call · WhatsApp · Email · Book a call*) under the
  signature, separate from the primary button, pruned to methods whose field is present.
- **Salesperson profile (persisted)**: portrait photo (upload/replace/remove) + editable contact details, remembered
  per salesperson and prefilled next time. The portrait also shows in the **app header** beside the signed-in email,
  updated live on upload or removal.
- **Salesperson attribution** (23 Sept): an automatic `utm_term=<salesperson>` on every link back to the website —
  no set-up by the salesperson (B7, "Attribution").
- **Brochures** (design in **B7b**): the finder searches, understands the manufacturer's site, operates the model's
  page and verifies what it finds; a verified **UK** brochure, price & spec guide or web brochure attaches by
  itself (our hosted PDF, or a link). No allowlist, no picking from a list. A manufacturer's **European brochure in
  English** is only ever **offered**: the salesperson uses it, puts their own in its place, or sends without. An official
  page that holds a protected file, a price-list hub and a request-a-brochure form are offered for one click too.
  When nothing is found the salesperson sees what was checked and can upload, paste a link, or send without.
- **European-edition small print**: when the attached brochure is a European edition the card's small print says
  so ("This is the manufacturer's European brochure; specification, equipment and prices may differ from UK
  models."); grid3's shared footnote has a variant. Wording is Matt's; Emma has not approved it yet.
- **One offer per row** (Matt, 21 Sept): a single offer renders as the hero card, two to six as stacked rows —
  image beside the details on a desktop, image above the details on a phone. The layout picker is gone.
- **Offer library** — a curated central repository (redesigned 23 Sept 2026; **B7c**): a salesperson's own shelf
  plus admin-curated **shared shelves**, priced **live on use** (never a frozen price), with a **URL-health** flag
  when a source page has moved/gone, a current/archived split, and a 6-month archive purge. **An offer pulled from
  the library arrives with the model's stored brochure attached** (23 Sept), shown in the tray with Remove /
  Replace (upload or paste a link) / Search again.
- **Campaigns** — an **identifiable list** (each row shows its vehicles, a draft/sent badge, the audience and the
  subject; the recipient is never stored so it never identifies a row), an in-place **Details** expander (every
  offer with price and terms, intro, sender), and per-campaign stats. **Copy a past campaign** starts a fresh
  draft in Compose from it: the offers and the reusable parts (name, subject, preheader, intro, audience, sender,
  CTA) carry over, the **recipient never does**, and **every offer is re-priced live from its own source URL** on
  copy (the same silent-stale guard as the library — B7c). Since 23 Sept the copy also **re-attaches each model's
  stored brochure** (`api.currentBrochure` → `GET /api/brochures/current`, the stored copy only, never a search); an
  offer that cannot be re-priced keeps its copied price and is not re-brochured, and the warning says so. A campaign
  **never** flows into the library. Client-only (`apps/web/src/Campaigns.tsx`, `App.tsx` `copyCampaign`,
  `Compose.tsx` `repriceCopied`) — no API change.
- **Promotions register** (master table + CSV). Use case "Other…" carries the salesperson's words (`useCaseNote`, ≤ 80 characters), shown as "Other: …" (29 Sept).
- **Guidance and defaults (29 Sept):** Compose shows six numbered steps (Who it's for, Your message, Your details, Add
  offers, Check and create, Send from Outlook); Renewal is the default use case; WhatsApp is shown "coming soon" and
  cannot reach an email (`WHATSAPP_LIVE` in `Compose.tsx`); preview links point straight at the site in a new tab
  (the created campaign keeps its tracked `/r/` links).
- **Library, simplified (29 Sept):** tabs Team offers (first) and My saved offers; Add to email and Remove per card;
  admins see removed offers, restore them and Share with team. Archive / unarchive need the entry's owner or an admin.
- **Brochure near miss (29 Sept):** when nothing verifies, the panel offers the closest document from the stored trace
  (Open it / Use it anyway via the paste route); wrong models, other continents, manuals, dealer copies, forms and
  non-English files are never offered. An ended offer's link gets "This offer is no longer on the website…".
- **Compliance templates (compliance approver only, 28 Sept 2026)**: Emma (`config/compliance.json`) authors the
  compliance wording, publishes it (stamped with her verified sign-in), locks approved, new-version/retire. Master
  admins can read it but not change it. The seeded placeholder is labelled "not compliance-approved" and carries no
  approver. See A4 / B6.
- **Suppression register**: the opt-out list — add / check / view / CSV export; admin-only removal. See A4.

## A4. Security & compliance posture
### The four rules that never bend (see `CLAUDE.md`)
1. **Three layers, no leaks.** `packages/schema` is the model; source adapters produce `Offer`s, output
   adapters deliver a `Rendered` campaign; `render()` is the **only** place email/hosted HTML is produced;
   React never builds HTML; no adapter imports another.
2. **CAP IDs are never stored** — not in D1, R2 keys, filenames, logs or HTML. Images/brochures/headshots are
   content-addressed by the sha256 of our own bytes; only our R2 URL is kept. `assertNoCapId()` guards every
   persisted object, and the test suites assert that stored rows, link maps and rendered HTML carry no CAP ID or
   source image host (`pnpm test`, which GitHub Actions has run on every pull request and push to `main` since
   24 Sept: `.github/workflows/ci.yml`, plus the gitleaks secret scan in `security.yml`). No raw scraped HTML is ever
   persisted (24 h cache = parsed only).
3. **Compliance is locked.** Each template carries one approved compliance block per contract type; salespeople can't
   edit it; a campaign can't render against a template whose status is not `approved`. Salesperson-authored copy is
   recorded verbatim in the promotions register.
4. **A human presses Send.** From Phase 1 (B13): only the signed-in salesperson, from their own mailbox, after the pre-send checks, one customer, once; never automatically, never in bulk. Until Phase 1 is deployed the Worker never sends.

### PII posture — the plan is complete (16 Sept 2026)
- **Staff (salesperson) data is business contact data** — name, work email/phone/WhatsApp, booking link, signature
  photo — for the salesperson's own signature. Legitimate, minimal, expected; a signature headshot is not special-
  category. No minimisation/retention/encryption applied to it (Matt's call: it's business data).
- **Customer (recipient) PII is minimised, not stored.** The recipient object is personalisation for the
  render only: it builds the email greeting and is **stripped at the persist boundary** — never reaches D1.
  The first name renders in the **email only**, never on the public hosted page. *(item 1 + 2 — done.)*
- **Engagement logging is PII-free** — the click/view log holds a coarse device class + timestamp, no IP, no
  full user-agent.
- **Retention** *(item 3 — done)*: a daily Cron (`retention.ts`) purges the 24 h lookup cache always, and
  campaign records **only when `RETENTION_CAMPAIGN_DAYS` is set** — safe by default so the FCA record is never
  deleted by accident; a purged campaign takes its clicks + hosted page with it. Emma sets the period.
- **Suppression register** *(item 4 — done, as plain text not hashed)*: opt-out emails are stored **in the
  clear** behind Access, admin-gated removal, with a clear lawful basis (held to honour the opt-out) and CSV
  export. Decision (Matt): lowest friction = most auditable = least perceived risk; a hashed list nobody can
  read is worse for a compliance register.
- **Platform security:** Cloudflare encrypts D1 and R2 at rest; TLS in transit; behind Access/Entra; data in
  the **EU (WEUR)**.
- **Residual, by design:** salesperson-authored free text (campaign name, subject, intro) is kept as the FCA record
  and could contain a name if a salesperson types one — a training matter, not a schema one.
- **Logs carry no personal data or CAP IDs (24 Sept 2026)** — every error line goes through `safeErrorLine()`
  (`apps/api/src/safe-log.ts`). A failed database query's message would otherwise include the query's values
  (salesperson emails, contact details, campaign snapshots); only the database's own reason is kept.

## A5. The real send path, and what the email is built for (21 Sept 2026)

**Superseded direction (29 Sept 2026):** the demo showed that most salespeople use Outlook classic, whose editor is Word; a pasted email is rewritten there and breaks. The paste route below stays in use only until Phase 1 of `evolution.md` ships: the tool will send the email itself via Microsoft 365, so the style block and the `[if mso]` parts arrive intact, and the design will be certified in Outlook classic, new Outlook / web, Gmail and Apple Mail.
**Scope (Matt, 21 Sept):** get it right in **Gmail (web + mobile app) and New Outlook (desktop + mobile)** first.
Classic Outlook (Word's engine) and the full client matrix in the implementation notes are **not** the current
target; the markup still carries the `[if mso]` ghost tables for it, untested.

**The send path rewrites the email.** A salesperson copies the HTML and pastes it into a New Outlook message. Matt's real
sends of 21 Sept (read in Gmail web, Gmail iOS, Outlook desktop, Outlook mobile) established what arrives:
- **Survives:** table structure, widths and `max-width`, `display:inline-block`, background colours, borders,
  `border-radius`, bold, letter-spacing, link colours, images.
- **Does not survive:** the `<style>` block (so **no media query and no forced-light-mode overrides**) and the
  conditional comments (so no ghost tables). A float's clearing spacer was lost too.
- **Text colour and font size arrive flattened** (the 28px red price and the red make name arrive black and
  body-sized, in Gmail and Outlook alike) **only when Outlook pastes with Merge formatting**, its default for
  "Pasting from other apps" (Settings → Mail → Compose and reply → Cut, copy and paste). Merge formatting replaces
  every text run's font, size and colour with the account default and keeps bold, letter-spacing, line-height,
  backgrounds and link colour; no markup survives it. With **Keep source formatting** the markup arrives as
  designed. Established 22 Sept from the sent `.eml` and Outlook's own editor (`status-2026-09-21.md` §11).

**Design rule that follows:** nothing may DEPEND on the media query, the style block or `[if mso]`. They stay in
the markup as enhancement only. Responsiveness has to come from inline, fluid constructions (B7).

**Test sends must be real campaigns.** A campaign made on local storage points its images, hosted page and
tracked links at production, which does not hold them — every image and link in the first test was a 404
(Outlook hid it: it blocks images by default). Use `pnpm dev:live` (B3).

**How rendering quality is meant to be assured** (proposed 21 Sept, not built): certify the markup once per
`MARKUP_VERSION` on real clients over a fixture matrix (a screenshot service — Litmus, or Mailgun Inspect, the
former Email on Acid — because nothing else renders real Outlook), certify each send path by sending through it,
and run an automatic pre-send check in the tool that the campaign stays inside what was certified. Until then,
validation is Matt's own test sends.

---

# Part B — System Architecture

## B1. High-level shape
```
                     ┌──────────────────────── Cloudflare Worker "offer-mailer" (Hono) ────────────────────────┐
  Salesperson browser        │  /app/* (web app) + /api/*  (tool host, behind Cloudflare Access → Entra SSO)            │
  (marketingtools…)──►│    me/profile · lookup · brochures · campaigns · library · register                     │
                     │    templates (compliance) · suppressions (remove=admin) · dev-preview                    │
  Customer browser   │  PUBLIC (no login):  /health · /c/:slug (hosted) · /f/* · /b/:id · /r/:slug/:link · /a/* │
  (offers.…)      ──►│  Cron (daily 03:00): scheduled() → retention/housekeeping                                │
                     └──────┬──────────────┬─────────────────┬──────────────────┬────────────────────────────┘
                          D1 (SQL)      R2 (objects)    Images (TRANSFORM)   Firecrawl (metered, external)
```
Two hosting surfaces on one Worker (decided by Matt, 28 Sept 2026; how and why in `status-2026-09-28.md` §2; live since 29 Sept, `status-2026-09-29.md`). **Keep the `dreamelectric.uk` zone's Snippets off:** four from the MotorComplete test site proxied every request on the zone to MotorComplete after sign-in (disabled 29 Sept):
- **`marketingtools.dreamelectric.uk`** — the tool: the web app (`/app/`) + `/api`, staff-only; Cloudflare Access
  covers the whole host. A Custom Domain on our `dreamelectric.uk` zone. `TOOL_BASE_URL`.
- **`offers.dreamlease.co.uk`** — hosted pages, redirects, images, brochures — public (noindex, expiring), on the
  DreamLease domain so customers can trust it. A **Cloudflare for SaaS** custom hostname on the `dreamelectric.uk`
  zone (fallback origin `saas.dreamelectric.uk`, `AAAA 100::`), sent to the Worker by the route
  `offers.dreamlease.co.uk/*`; 123-Reg keeps DreamLease DNS and holds two records for it (CNAME + TXT).
  `PUBLIC_BASE_URL` moves to it once it is verified live.

Why not a `dreamlease.co.uk` zone of our own: the main site (`www`) and its certificates are run by MotorComplete
through their own Cloudflare account (their validation records live in our 123-Reg DNS), DNS is at 123-Reg, and
proxying one subdomain from outside DNS needs Cloudflare's Business plan. `mailer.` is taken by an unrelated host.

The Custom Domain and the route are attached once in the dashboard (runbook Part C), **not** listed in
`wrangler.jsonc`: with a `routes` key, `wrangler dev --remote` previews on the first route's zone instead of
workers.dev and `pnpm dev:live` stops running the local code (seen 28 Sept). `wrangler deploy` publishes only the
routes the file lists, so it leaves the dashboard ones alone (wrangler 4.131 `triggersDeploy`). `workers.dev` stays on
so links in emails already sent keep working. Until Access is configured, `/api/*` returns **503** on every host
(fails closed).

## B2. Monorepo layout (pnpm workspaces)
| Package | Responsibility |
|---|---|
| `packages/schema` | Zod offer model + `assertNoCapId`. The shared contract. |
| `packages/adapters` | Source & output adapters, pure: URL lookup (normalise → parse → pricing → buildOffer), Firecrawl client (search, map, scrape with page actions, raw file fetch), brochure finder / operate (the in-page script) / harvest (which also holds the manual upload-or-paste path and the accept paths) / ensure; `scripts/finder-sweep.mts` (live proof runs). No adapter imports another. |
| `packages/render` | `render(campaign, template)` — the sole HTML producer. v5 markup as template functions (`cards.ts`, `render.ts`), with the recorded deviations of B7; two layouts, hero and stacked (the grids were deleted 22 Sept); `diff-reference.ts` fidelity check; `MARKUP_VERSION`. |
| `packages/design-system` | Vendored DreamLease design system (`dl-*` React components, tokens, Sofia Pro), consumed as source. |
| `apps/api` | The Cloudflare Worker (Hono): API, hosted pages, redirects, files, static assets, the retention Cron. |
| `apps/web` | Vite + React tool UI: Compose / Campaigns / Library / Register / Suppressions / Templates (compliance edits, admins read). Built into `apps/api/public/app` (git-ignored) and served by the Worker at `/app/` on the tool host only (`apps/api/src/ui.ts`, 28 Sept); `pnpm run deploy` builds it first. In development it runs on Vite (5173). |

## B3. Runtime & bindings (Cloudflare, account `9b8d051…`; the Workers Paid plan is the design assumption — Matt to confirm it is switched on, it cannot be seen from the repo)
- **Worker** `offer-mailer` (`apps/api/wrangler.jsonc`), `nodejs_compat`, observability on; static assets from
  `./public` via `ASSETS`: `/a/*` straight from the assets on every host; `/` and `/app/*` go to the Worker first
  (`run_worker_first`), which serves the built web app only on the tool host; **Cron trigger** `0 3 * * *` (retention).
- **D1** `offer-mailer` (`32d1b987-…`, WEUR), binding `DB`, Drizzle ORM, migrations in `apps/api/migrations`.
- **R2** (WEUR): `offer-mailer-images` (`IMAGES`), `offer-mailer-hosted` (`HOSTED`), `offer-mailer-brochures`
  (`BROCHURES`).
- **Images** binding `TRANSFORM` (vehicle → 1200px JPEG; headshot → 256px square).
- **Access** — `ACCESS_TEAM_DOMAIN` (a var: `dreamlease.cloudflareaccess.com`, set 28 Sept; team name
  **`dreamlease`**) + `ACCESS_AUD` gate prod. `ACCESS_AUD` is a **production-only secret** since 28 Sept (`wrangler
  secret put ACCESS_AUD`, runbook B5), not a var, so local dev and the tests keep the `DEV_USER_EMAIL` bypass without
  editing the file. **Still unset in production** until Matt completes runbook Part B.
- **Vars/secrets** — secrets `FIRECRAWL_API_KEY` (**not set in production**: `/health` reports `firecrawl:false`)
  and `ACCESS_AUD`; vars `PUBLIC_BASE_URL` (customer links), `TOOL_BASE_URL` (the only host serving the web app),
  optional `ADMIN_EMAILS`, `COMPLIANCE_EMAILS`, `RETENTION_CAMPAIGN_DAYS`; locally `.dev.vars` (git-ignored,
  `DEV_USER_EMAIL`).

### Two ways to run the tool locally
| Command | Storage | Use it for |
|---|---|---|
| `pnpm dev` | local D1 / R2 / Images (miniflare) | building and the test suite. **Never for an email that will be sent**: its images and links point at production, which does not have them. |
| `pnpm dev:live` (`wrangler dev --remote`) | **production** D1 / R2 / Images | any real test send, and day-to-day use until Cloudflare Access exists. The local code renders; production serves the images, hosted page, redirects and brochures. It writes real production data (test campaigns land in the promotions register; wipe before go-live). |

Both take the dev sign-in from `.dev.vars`; the Vite UI (`pnpm --filter @offer-mailer/web dev`, port 5173) proxies to
whichever is on 8787. Production `/api` itself stays 503 until Access is configured.

**Starting the servers (24 Sept).** `.claude/launch.json` defines `api-live` (`pnpm dev:live`, port 8787) and `web`
(the Vite UI, port 5173) so the Claude desktop app can start and manage both; since 28 Sept also `api-local` (plain
`wrangler dev` on port 8788, local storage), for checking the built web app as the Worker serves it
(`localhost:8788/` → `/app/`, after `pnpm build:web`). `dev:live` runs at Cloudflare's edge, so it does not count as
"this laptop" and does not serve `/app/`. It calls `pnpm` by its full path
(`%AppData%\npm\pnpm.cmd`) because `pnpm` is installed but not on Matt's PowerShell `PATH`. Servers started this way
are stopped by the app when its Browser pane is closed; a `dev:live` session also drops after a few hours.

**Sharing the running tool without a deploy (23–24 Sept).** There is no LAN, so a colleague off-machine reaches the
local tool through a **Cloudflare quick tunnel**: `cloudflared tunnel --url http://localhost:5173` (the binary is at
`C:\Users\MatthewWilson\cloudflared.exe`; no Cloudflare login needed). It prints a random
`https://<words>.trycloudflare.com` address, which is **new every time the tunnel starts** and dies with the tunnel,
the local servers or a sleeping PC; a stable address needs a named tunnel on a Cloudflare-served domain (the parked
subdomain work). `apps/web/vite.config.ts` lists the tunnel domains in `server.allowedHosts` (`.trycloudflare.com`,
`.ngrok-free.app`, `.ngrok.app`, `.ngrok.io`, `.loca.lt`) so Vite answers them; localhost and IPs are allowed by Vite
anyway. **Security:** the dev bypass means **anyone with the link is signed in as `DEV_USER_EMAIL` (Matt, admin) on
production data** through `dev:live` — share narrowly, briefly, and wipe test data after. It must never be replaced
by setting `DEV_USER_EMAIL` in production (CLAUDE.md).

## B4. Data model & storage
### D1 tables (`apps/api/src/db/schema.ts`) — JSON snapshots validated by `@offer-mailer/schema`
| Table | Holds | PII |
|---|---|---|
| `campaigns` | Campaign snapshot + slug, template id/version, `createdBy`, timestamps, `links` map | salesperson email + sender; **no recipient** (stripped at save) |
| `library_entries` | The offer library (B7c): `LibraryEntry` JSON + facet columns (scope, category, status, url_health, make, model, fuel, body, contractType, monthly, validUntil, addedBy, addedAt, archivedAt, lastPricedAt) indexed for search and the future matcher | salesperson email |
| `offers` | Legacy saved-offer table (pre-23 Sept); superseded by `library_entries`, kept until its rows are re-saved | salesperson email |
| `templates` | Compliance templates (blocks, footer, markup/version, status, approvedBy/At) | approver email |
| `brochures` | Brochure metadata (PDF bytes are in R2) | salesperson email (`createdBy`) |
| `brochure_searches` | Latest completed brochure search per vehicle: outcome, market, edition, and the trace (queries, pages opened, every document with how it was discovered, the action taken and why it was kept or dropped). Also what `/brochures/accept` acts on: an official page, a request form, or an offered European edition. A "nothing found" is remembered 7 days; a search that never reached a page of the official site (`exhausted: false`) only 1 day; never a failed search, and never one made under an older `FINDER_VERSION` (a rules change re-runs, and re-pays for, those searches) | salesperson email |
| `senders` | Salesperson profile (name/phone/WhatsApp/booking/secondary + headshot URL), keyed by email | salesperson business data |
| `clicks` | Click/view log: coarse uaClass + timestamp | **none — no IP/UA** |
| `suppressions` | Opt-out **emails (plain text)** + addedBy/at/note | recipient email (lawful basis; admin-removable) |
| `lookup_cache` | 24 h parsed lookup results — never raw HTML; purged daily | salesperson email (the cached `Offer` carries the `createdBy` of whoever looked it up first) |
| `mail_connections` | Phase 1 (migration `0004`, B13): each salesperson's Microsoft 365 connection: the refresh token **encrypted** (AES-GCM, `MAIL_TOKEN_KEY`, bound to the email), scopes, connected / updated / last sent. Deleted on Disconnect, when Microsoft ends it, or after 90 days unused (daily Cron) | salesperson email; **no customer data** |

### R2 objects
| Bucket | Holds | Key | Served |
|---|---|---|---|
| `offer-mailer-images` | vehicle images + salesperson headshots | `vehicles/<sha256>.jpg`, `headshots/<sha256>.jpg` | `/f/vehicles/*`, `/f/headshots/*` |
| `offer-mailer-hosted` | rendered hosted offer pages | `c/<slug>.html` | `/c/<slug>` (noindex, expiring) |
| `offer-mailer-brochures` | brochure PDFs | `brochures/<sha256>.pdf` | `/f/brochures/*`, `/b/<id>` |

### Limits & residency
- **D1:** 10 GB per database on the Paid plan; live usage ~200 KB — never a concern. (The Free-tier daily row cap
  goes away with Workers Paid.)
- **R2:** no total cap, per-GB-month billing (10 GB/mo free); per-object 5 GiB single / 5 TiB multipart.
- **Residency:** D1 + R2 in **WEUR (EU)**. Cloudflare is the processor (standard DPA applies).

## B5. Routing surface (`apps/api/src/index.ts`)
**Public (no login):** `/health` · `/c/:slug` · `/f/*` · `/b/:id` · `/r/:slug/:link` · `/a/*` · `/` (tool host →
`/app/`; any other host → `https://www.dreamlease.co.uk/`).
**The web app:** `/app/*` — the built files on the tool host (Access covers the whole host at the edge); 404 on every
other host, so the internal tool never appears on the customer-facing address (`src/ui.ts`, 28 Sept).
**Behind Access (`/api/*`):** `/me`, `/me/photo`, `/me/sender` · `/offers/lookup` · **library (B7c):**
`/offers/library` (save · list current, `?scope=&category=&q=&maxMonthly=`), `/offers/library/archived`,
`/offers/library/:id/reprice`, `/…/archive`, `/…/unarchive`, `/…/promote` **(admin)**, `/library/shelves` ·
`/brochures/ensure`, `/brochures/accept` (an official page, a request form, or the European edition the finder offered), `/brochures/manual`, `/brochures/current` (the stored copy, no search) · `/campaigns*`, `/register`, `/register.csv` ·
`/templates*` **(read: admin or compliance; write: compliance only)** · `/suppressions`, `/suppressions.csv`, `/suppressions/check`,
`/suppressions/remove` **(remove = admin)** · **Phase 1 (B13):** `/mail/status`, `/mail/connect`, `/mail/callback`, `/mail/disconnect`, `/campaigns/:id/checks`, `/campaigns/:id/send` · `/dev/*` · `/openapi.json`.
**Described in OpenAPI 3.1** at `/api/openapi.json` (behind Access, versioned with `APP_VERSION`; source
`apps/api/src/openapi.ts`, added 24 Sept). `test/openapi.test.ts` fails if a route is served but not documented, or
documented but not served, so the description can't drift. Request bodies come from the Zod model where the handler
validates with Zod; hand-checked bodies are marked `x-validated-by: handler` (see B12).
**Cron:** `scheduled()` → `runRetention()` + `recheckLinkedBrochures()` (a web / request brochure whose page is now
404/410 is superseded) + `recheckLibraryUrls()` (flag a library entry whose source URL moved/gone) +
`purgeArchivedLibrary()` (archived library entries > 6 months).

## B6. Authentication & authorization
- **Authentication** — Cloudflare Access with **Microsoft Entra ID** as IdP. Access stamps each request with a
  `Cf-Access-Jwt-Assertion`; `requireAccess()` (`middleware/access.ts`) verifies it against the team JWKS +
  `ACCESS_AUD`; the verified **email** becomes the user identity, used as `createdBy` everywhere. No passwords
  stored. Local dev: with `ACCESS_AUD` empty, `DEV_USER_EMAIL` is accepted; with it set the bypass is inert
  (misconfigured prod fails closed 503).
- **Cross-site guard (24 Sept 2026)** — `hono/csrf` runs before `requireAccess()` on `/api`. A write from another
  website (a form, an upload, a delete), which the browser would send with the salesperson's Access cookie, is
  refused with 403. The tool's own requests come from the same origin and pass. A non-browser caller can send
  JSON writes (`content-type: application/json`), but not the two uploads (`/api/me/photo`, `/api/brochures/manual`)
  or a bodyless write without that header: those are same-origin only until machine sign-in lands (B12). Reads and
  the public routes (all GET) are unaffected. `test/security.test.ts`.
- **Entra set-up (status 24 Sept)** — **one** app registration for sign-in (Phase 1 adds a second, the Send app, runbook Part D and B13), sign-in only (delegated `openid`, `email`,
  `profile`, `offline_access`, `User.Read`; a 12-month client secret; redirect
  `https://dreamlease.cloudflareaccess.com/cdn-cgi/access/callback`). Matt is not the Entra administrator: the
  click-by-click instructions for IT are `it-runbook-sign-in.md` Part A (revised 24 Sept to Microsoft's current menu
  names) and a matching Word document outside the repo. **IT has done Part A** (the IDs came by email; the secret, due
  to expire 24 Sept 2027, by phone). Next is Matt's Part B: Entra as the identity provider, one Access application on
  the whole `marketingtools.dreamelectric.uk` host, then the audience tag as the `ACCESS_AUD` secret after a deploy.
  `requireAccess()` checks the token on every host, so once `ACCESS_AUD` is set `/api` on `workers.dev` or
  `offers.` answers 401: the tool works only through the protected host.
- **Authorization (roles, built — `roles.ts`)** — two roles plus one permission:
  - **Salesperson** — the default; uses the tool.
  - **Master admin** — admin-only actions (library promote, suppression removal); can **read** templates.
    Mapping: `config/admins.json`, optionally extended by `ADMIN_EMAILS`, resolved by `roleFor(env, email)`.
  - **Compliance approver** (28 Sept 2026, Matt: "Emma alone edits and approves") — the only people who can create,
    edit, publish and retire compliance templates; publishing stamps `approvedBy` with the approver's verified
    email, so the register can only ever name the person who pressed Publish. `config/compliance.json` (Emma),
    optionally extended at runtime by `COMPLIANCE_EMAILS` (a deputy, without a code change); `isComplianceApprover`,
    `requireCompliance()` on template writes, `requireAdminOrCompliance()` on template reads. Separate from the
    role: an approver who is not an admin uses the rest of the tool as a salesperson. Before 28 Sept master admins
    self-approved templates; that is gone.
  All case-insensitive and off whatever email Access supplies. `/me` returns `role` and `complianceApprover` so the
  web app branches views (Templates is read-only for admins); the API enforces the same split, and
  `test/templates.test.ts` proves an admin's writes are refused.

## B7. Rendering & the email template
`render()` is pure and the only HTML producer. Card markup is translated line-for-line from
`design/dreamlease-offer-mailer-v5.html`; after any `cards.ts`/`render.ts` change run
`packages/render/scripts/diff-reference.ts` — any non-data structural difference is a deviation, justified in the `cards.ts`
header. **Auto layout is one offer per row: 1 → single (hero), 2+ → stack** (Matt, 21 Sept). The grid2 / grid3 cards
were deleted on 22 Sept; the schema still accepts the names so a stored campaign parses, and it renders stacked. `MARKUP_VERSION` is bumped
when the markup changes in a way Emma should re-approve; templates pin the version they were approved against
(campaigns pin `compliance.approvedWordingVersion`).

Two data-side display rules live in the viewmodel (not markup, so the reference is untouched): **PCH
(personal) cards always show the standard £299.99 processing fee** even when the site returned none (BCH/salsac
unchanged — first stage); and **every card in a multi-offer campaign shows the same, even number of stat
tiles** (the common count across the offers, floored to even) so the cards read as a matched set — a single
hero keeps its natural count. A third (21 Sept): when the attached brochure is the manufacturer's **European
edition** (`Brochure.market === 'eu'`), the small print adds "This is the manufacturer's European brochure;
specification, equipment and prices may differ from UK models."

**Inbox preview (23 Sept).** The Compose preheader field was removed. `render.ts` `preheader()` uses an explicit
`campaign.preheader` if there is one (a copied older campaign may carry one), otherwise it derives the hidden preview
text from the intro: whitespace collapsed, the first ~100 characters cut at a word boundary with "…". Without it the
inbox would fall back to the first visible text, the "View these offers online" link. Email only; the hosted page has
no preheader. Tested in `render.test.ts`.

**Attribution (23 Sept).** `links.ts` `campaignUtm(code, extra)` is the one UTM base for our own website links:
`utm_source=offer_mailer`, `utm_medium=email`, `utm_campaign=<campaign code>`, plus `campaign.tracking.utm`. The server
sets `tracking.utm = { utm_term: salespersonTag(createdBy) }` in `buildCampaign` (`apps/api/src/campaigns.ts`): the
salesperson's work-email local part, lower-cased and hyphenated (`matt.wilson@…` → `matt-wilson`), so it needs no
set-up and is stored with the campaign. Offer links add `utm_content=<offer id>`; the footer's dreamlease.co.uk link
takes the base alone. The tags sit on the **destination** in the stored link map, so the email HTML is unchanged and
`diff-reference` is unaffected; `/r` delivers them to the site, where GA4 records `utm_term` without site-side set-up.
Matt, 23 Sept: "whatever works as salesperson identifier", so `utm_term` stands.

**Deviations from the v5 reference, all for the paste path of A5** (recorded in the header of `cards.ts`;
`diff-reference` reports 84 lines: 8 pre-date 21 Sept (2 the logo width, 6 the third hero pill), 10 are the inline-block pills (6) and the stack card’s image column (4), 64 are the name-before-picture reorder of 22 Sept (50 the stacked card, 14 the hero), and 2 are the plain recipient greeting (23 Sept, render.ts’s intro); the fluid wrapper sits outside the sections the script compares). **`MARKUP_VERSION` was not bumped for them (still 2)**, so templates approved against it — including the
seeded placeholder (which nobody approved: since 28 Sept it is named "Placeholder wording (not compliance-approved)"
and carries no approver) — keep rendering (`render()` refuses a mismatch); whether Emma should re-approve the changed
markup is undecided:
- **Fluid wrapper** — `width:100%; max-width:600px`, not a fixed 600px. Outlook mobile shrank the fixed layout to
  fit instead of reflowing it, so side-by-side columns stayed side by side on a phone. Classic Outlook keeps its
  600px from the ghost table around the wrapper.
- **Badge pills are inline-block tables, not `align="left"` floats** — a float needs the spacer after it to clear,
  that spacer did not survive the paste, and in Gmail the make name ran beside the pill and broke.
- **The stack card's image column is calc()-fluid** — `width:calc((480px - 100%) * 480); min-width:250px;
  max-width:100%`: 250px beside the details on a desktop, the full card width once the columns wrap on a phone
  (the media query's old job). A client without `calc()` falls back to the fixed 250px column.
- **The car's name comes before its picture on both cards** (22 Sept, deviation d). Stacked card: the heading (badge,
  make, model, derivative) is a row across the top and the small print a row along the bottom; between them the
  image sits beside price / stats / button. The reference kept the heading in the details column and the small
  print under the image, so on a phone, where the columns wrap, the legal line came between the picture and the
  car's name (Matt's screenshots, 22 Sept). Hero: the same heading row above the full-width image, carrying the
  card's rounded top corners; the image is square below it (Matt: "it should match").
- (Earlier, 14 Sept) up to three pills on the hero where the reference has two; logo 98px wide.

**Matched rows** (`match.ts`, `measure.ts`) and the grid cards were deleted on 22 Sept, once Matt had confirmed the
stacked layout in Gmail and Outlook (`status-2026-09-21.md` §14). The history is in `status-2026-09-21.md` §7.3.

## B7b. Brochure discovery — the finder (`finder-1.4`, 21 Sept 2026)
Code: `packages/adapters/src/brochure/` — `finder.ts` (pure; Firecrawl and a plain GET are injected), `operate.ts`
(the script that runs inside the page), `harvest.ts` (retrieve, store, record, accept), `ensure.ts` (stored / fresh
/ stale / none). History and evidence: `brochure-finder-brief.md`, `status-2026-09-18.md`, `status-2026-09-21.md`
§3, §8–§10.

**Principle** (Matt, 21 Sept: "you are not leveraging Firecrawl capability to its optimum"): *search discovers, Map
and Scrape understand the site, the page is operated, and strict validation happens only once a document is in
hand.* The earlier versions judged documents from search metadata and threw the right ones away unopened.

**When it runs** (`ensure.ts`): one current brochure per make/model, shared by every salesperson. A stored copy inside its
90 days and its edition limit is reused for nothing. Otherwise a remembered result is returned (7 days for "nothing
found", 1 day for a search that never reached the official site, never a failed search, never one from an older
`FINDER_VERSION`), or the finder runs. "Search again" forces it.

**Pipeline**
1. **Search** twice at once, UK-located: `"<make> <model>" UK official brochure PDF` (web) and
   `<make> <model> brochure` (PDFs). Every PDF hit is a candidate.
2. **Identify the official UK site** from the hits. The host is the make, optionally with a generic word after it
   (cars, auto, motors, automobiles, motorcars, uk, gb, global…), a known word before it (saic…) or the model after
   it (ineosgrenadier); any subdomain counts; `.ie` counts (Ireland is the likeliest English European source). UK =
   a `.uk` host, a `/uk/`-style path, or a result that describes itself as UK. Dealers and press offices fail.
3. **Map** the site (`<model> brochure`) for this model's page and its brochure / download / price pages. Fixed
   paths and a `site:` search are only the fallback when Map returns nothing.
4. **Open the model's own page first**, chosen properly: any spelling the variants allow ("E-208" / "208"), never a
   fleet, Motability, offers, news or tutorial page, never another model's, the base page rather than a trim's.
   Brochure / download pages are opened only if the model's page gave no brochure.
5. **Operate the page** (`operate.ts`): one Scrape with `actions`. In Firecrawl's browser the script hooks
   `window.open`, `a.click()`, `fetch`, XHR and link clicks, dismisses a cookie banner, notes the rendered links,
   presses the controls labelled brochure / download / specification / price list one at a time, and reports each
   file with HOW it was reached and the LABEL that led to it. It never presses a request, test-drive or configurator
   control and never fills in or submits anything. The page's markdown links (a bare "Download" is read by the
   heading above it and the words before it) and the PDF addresses held only in the page's own data are read too.
6. **Queue the candidates.** Dropped on sight: aggregator / file-sharing hosts, rest-of-world addresses, archive and
   used-car addresses, and anything that is not sales literature (manuals, warranty, accessories, press packs,
   Motability guides, offer terms, company reports). A European address is kept for the fallback tier only.
   Provenance gates what is opened (official host, or linked from the official site); the score only ORDERS the
   queue: brochures before price guides, a file that names exactly this model before a generic redirect. Another
   model's document is refused by name ("c-hr-plus.pdf" is not the C-HR's), also after a link has been resolved.
7. **Read and validate** (first four pages; at most 4 documents, 25 credits): make and model in the text (the
   model's own page vouches for the model); the type established; an edition date (text, address, CMS file name,
   else the `Last-Modified` header) inside the limit — 12 months for a brochure and 6 for a price guide, or **36 / 12
   when the manufacturer's own site is serving it today**, flagged `older_edition`, and the search carries on for a
   newer one; at least 2 of 5 UK signals (UK path on the official host, linked from the official site, reached from
   a UK page, £ / OTR, UK wording); not euro-only.
8. **Outcomes, in this order:** UK PDF → UK web brochure (a page that is really a form becomes a request) →
   **European English-language brochure** (brochure only, English by a function-word test, says it is European,
   never a price guide, never dollar-priced) → official page only (protected file, image-only file, price-list hub)
   → request-a-brochure form → search failed (everything opened failed; never remembered) → nothing verified.

| Status | Attaches by itself? | What the salesperson gets |
|---|---|---|
| `verified_pdf` / `verified_web_brochure`, market `uk` | **Yes** | Our hosted PDF, or a link to the manufacturer's web brochure |
| the same with market `eu` (flag `european_offer`) | **No — offered** | Use it · open it first · use my own · search again · send without |
| `official_page_only`, `brochure_request` | No — offered | One click to link the official page / request form |
| `not_verified`, `search_failed` | No | What was checked; upload / paste; retry when it failed |

**After a find** (`harvest.ts`): the PDF is fetched directly, then through Firecrawl; it must be a real PDF of 40 MB or
less; stored under its own hash; a file its host will not release is downgraded to "official page only" and never
worked around. An accepted European edition is fetched and stored only at that moment, is titled "(European
edition)", and a copy another salesperson accepted arrives **unticked**. Manual upload / paste always works and becomes the
stored copy for everyone. Replaced copies keep serving sent emails; a daily job retires linked pages that now 404.

**The trace** (`BrochureSearch`): queries, pages opened, why the site was taken to be official, whether the search
really looked (`exhausted`), and per document: every way it was discovered, the action taken
(`pressed "Download Geely EX2 Brochure"`), its evidence, and why it was kept or dropped. **A reported miss is
diagnosed from this row** (production D1 `brochure_searches`, by `vehicle_key`), not by guessing.

**Proving a change:** `packages/adapters/scripts/finder-sweep.mts` runs the finder LIVE over a list of cars and
prints the traces. The first finder-1.4 sweep found three WRONG attachments that 200 tests had not. 18 recorded
manufacturer sites replay at zero credits in the test suite. Sweep of 21 Sept, 17 cars: 13 right attachments, 3
correct one-click offers, 1 correct nothing.

**Known weak spots:** a brochure that only appears after a model is chosen in a form (Kia UK); price-list hubs are
offered as a page rather than followed to the model's file (Peugeot, Volvo); a variant can be taken for the model
(Puma Gen-E); the rest of DreamLease's range has not been swept; production has no Firecrawl secret, so the finder
only runs through `pnpm dev` / `dev:live` today.

## B7c. Offer library — the curated repository (23 Sept 2026)
Code: `packages/schema` (`LibraryEntry`, `libraryFacets`, `LIBRARY_ARCHIVE_PURGE_DAYS`), `apps/api/src/library.ts`
(repo, routes, Cron helpers), `apps/api/src/db/schema.ts` (`library_entries`, migration `0003`),
`config/library-shelves.json` (the shared shelves), `apps/web/src/Library.tsx` (the screen). Matt's decisions of
23 Sept.

**Principle:** the library is a curated *shortlist of vehicles + configurations*, not a frozen price list. An
entry keeps only a "last known" price for the browse card; the **live price is re-fetched from the offer's own URL
the moment it is used** (`/reprice`, then again as it is added to a campaign), so a stale price can never ship. It
is the same silent-stale guard as the brochure finder, applied to prices. **Copying a past campaign reuses the
same guard** (A3): `Compose.tsx` `repriceCopied` re-fetches every copied offer from its source URL, keeps the
copied price only when the source has moved (and flags it), and preserves hand-entered salary-sacrifice nets.

**Brochures ride along on use (23 Sept).** A brochure is shared by `vehicleKey`, not stored on the entry, and a
live lookup never carries one — so before this, every re-price silently dropped the offer's brochure (Matt's Renault
5: the `renault/5` PDF was stored, the library entry's `offer.brochure` was null, and the campaign went out without
it). Now `/reprice` looks up the current brochure for the vehicle and re-attaches it through `withStoredBrochure()`
(`library.ts`): `include` keeps the entry's prior choice, else it is on for a UK edition and **off for a European
edition** (the finder's "offered, never attached by itself" rule). The response carries the brochure record so
`App.tsx` `addFromLibrary` puts it in the tray and `BrochureControl` shows it attached. Copy-a-campaign does the
same client-side from `GET /api/brochures/current`.

**Two surfaces / roles**
- **Personal shelf** — a salesperson's own saved offers (`scope: 'personal'`, `addedBy` = them); only they see them.
- **Shared shelves** — the central curated ones (`scope: 'shared'`, a `category`), that everyone pulls from. Only an
  **admin** curates them (`/promote` and shared-scope deletes are admin-gated; the button only renders for admins).
  Shelves come from `config/library-shelves.json` (admin-extensible): **PCH latest deals, BCH latest deals, EVs**
  (manual), and **Deals under £300 per month** (a **smart** shelf filtered live on the `monthly` facet).

**Promote = copy** (not move): promoting a salesperson's entry creates an independent shared entry (a new id, the
admin as owner); the salesperson keeps their own. Promoting never removes anyone's saved offer.

**Lifecycle**
- **current / archived.** Archived entries drop out of the working list; the daily Cron **purges archived entries
  older than 6 months** (`LIBRARY_ARCHIVE_PURGE_DAYS = 183`). Auto-archive on expiry / dead URL is the intent (plus
  manual archive); the manual archive/unarchive routes are built, the auto trigger is wired via the URL recheck.
- **URL health.** Dealer offer URLs move. Each entry has `urlHealth` (ok / moved / gone). `/reprice` and the daily
  `recheckLibraryUrls()` resolve the source; if it no longer prices the vehicle the entry is flagged and **blocked
  from use** with a hard "URL not current — update with the latest" (the salesperson re-fetches from Compose and
  re-saves). A transient failure changes nothing.

**Future matcher (not built, factored in):** the facet columns (make, model, fuel, body, contractType, monthly,
validUntil) are indexed so the planned personalised **offer matcher** — which will pick shared offers to fit a
customer's held details — is a query over `library_entries`, not a refactor. `libraryFacets(offer)` is the single
place those columns are derived.

**Tests:** `apps/api/test/library.test.ts` — personal vs shared, save/list/delete, archive/unarchive, admin
promote (copy), the smart shelf's price filter, most-recent-first + search, the dead-URL 409 flag, the 6-month
purge, entity-decoding on read, and `withStoredBrochure` (UK included, EU unticked, prior choice wins, none
unchanged). Proven live through the tool (Renault 5 name decoded, Polestar 2 promoted to
the EVs shelf while kept on the personal shelf).

## B8. External dependencies
- **Firecrawl** — the only metered/external service. Two jobs: the **fallback HTML fetch for the vehicle lookup**
  when the direct fetch fails (so it also sees dreamlease.co.uk offer URLs; wired only when the key is set, so
  inactive in production today), and **brochure discovery** (B7b), which uses four of its endpoints: **Search**
  (2 credits), **Map** (1), **Scrape with page `actions`** to operate a page in Firecrawl's own browser (1), Scrape
  with the PDF parser to read a document's first four pages (4), and `fetchFile` via `rawBase64` to retrieve a file
  past bot protection (about 2). Typical search: 10–12 credits; cap 25. Sees the URLs we scrape transiently; brochure PDFs land in our R2. **No customer PII.**
- **Microsoft Entra / 365** — identity only: one app registration, used by Cloudflare Access for sign-in. The
  Graph draft was removed from the plan on 24 Sept 2026, so the tool never gets mailbox access and needs no second
  Entra app.
- **Parked/deferred:** Tawk.to webchat (renewals-only stage one; parked in `status-2026-09-16.md` §7, design in
  `status-2026-09-15.md` §7); the custom-domain/prod-URL setup (`mailer.` occupied — `status-2026-09-16.md` §7 / memory); Google Sheets register export.
- **Next delivery path (future iteration):** hand the draft to monday.com's email tool (the brief's `monday` output
  adapter). It becomes a new rendering target, to be proven with real sends as Gmail and New Outlook are today.

## B9. Build status & roadmap (brief §8.2)

**From 29 Sept 2026 the roadmap is `evolution.md`:** Phase 1 send properly (Microsoft 365), Phase 2 the monday.com loop, Phase 3 renewals and follow-ups, Phase 4 bulk (Mautic) and brands. The table below is the original build order, kept for history.
| Step | State |
|---|---|
| 1 Scaffold, schema, D1, Worker, Access, deploy | Done, deployed |
| 2 `render()`, layouts, hosted page | Done (hero and stacked; the grids were deleted 22 Sept) |
| 3 URL lookup, image pipeline, brochure harvest | Done (brochure discovery rebuilt as the finder, 18 Sept) |
| 4 Web app | Built; served by the Worker on the tool host from the next deploy (28 Sept) |
| 5 Graph draft, Copy-for-Outlook | Copy-for-Outlook done; Graph draft **removed** (24 Sept 2026 — monday.com next) |
| 6 Redirects, click logging, stats | Done |
| 7 Template admin, approval, register, suppression | **Done** (register, compliance-approver-only templates since 28 Sept, suppression list) |
| 8 Stubs & `evolution.md` | Not started (low value) |

**PII plan: complete** (items 1–4). Build-order steps 1–7 done. **Production is v0.5.0** (21 Sept): the finder's
European fallback and the European-edition small print are live. The one-offer-per-row render is in `main` and is
what `pnpm dev:live` renders, so it is in use without a deploy (production serves what was stored; it does not
re-render a campaign).

**In `main` since v0.5.0 (sessions 6–8, pushed to `origin`, not deployed — they run through `dev:live`):** the
22 Sept render/paste work (grid cards deleted, name-before-picture reorder, the Keep-source-formatting paste fix);
the **offer-library rebuild as a curated repository** (B7c) with its `library_entries` table (migration `0003`,
applied to production D1); the **"rep" → "salesperson"** terminology sweep; the **identifiable campaigns list +
Copy a past campaign** with live re-pricing on copy (A3); and session 8 (23–24 Sept, commits `ac10c47` … `7ae069e`):
the "DreamLease exclusive" badge without its "!", the preheader field removed and the **inbox preview derived from
the intro**, the **plain (not bold) greeting**, the **automatic salesperson UTM**, **brochures re-attached on
library use and on copy**, the recipient field above the intro, **resizable Compose panels** and the **portrait in
the header**. Redeploying the Worker would ship all of it; it is deferred with the rest of go-live behind Access + the
subdomain, and a real test send from `main` should come first.

**Open from the 21 Sept test sends (in priority order):**
- **Flattened text colour and size on the paste path** (A5) — cause found 22 Sept: Outlook's Merge-formatting paste.
  The fix is the salesperson's paste mode (Keep source formatting), confirmed by Matt's real sends to Gmail and Outlook on
  22 Sept. The Copy for Outlook screen tells the salesperson (helper line under the button, 22 Sept).
- **Small print before the offer on a phone** — done 22 Sept (B7, deviation d): the stacked card now reads name,
  picture, price, button, small print. Confirmed by Matt's real sends to Gmail and Outlook, 22 Sept.
- **Grid code deleted** (22 Sept) once Matt confirmed the stacked layout in Gmail and Outlook: `halfCard`,
  `compactCard`, `ghostGrid`, `match.ts`, `measure.ts`, the grid tests and fixtures. The design reference keeps its
  grid sections; `diff-reference` no longer compares them.
- **Rendering assurance** (A5): certification on real clients + an automatic pre-send check. Proposed, not built.

**Queued / open decisions (from the 16 Sept UX pass — pick up next session):**
- **Badge control (salesperson-editable).** Salespeople want website-level control over the offer-card badge/tags — a
  Show-badge toggle, an editable badge with two-line `\n`, a tags editor with a ★ "hot" tag. **One decision
  first (touches rule 3): fixed approved list vs free text.** Today rule 3, the brief and the schema all say fixed list
  (`config/badges.json`). Free-text-but-recorded-in-the-register (with an optional claim-word denylist) was floated on
  16 Sept; it would mean rewriting rule 3, so it is Matt’s call, not a default. Not built. Today badges are auto-derived from the vehicle page only (no salesperson control), which is why a car the
  site didn't flag (e.g. the Golf) shows no pill.
- **Email cross-client validation.** Superseded by the approach in A5 (certify per markup version, certify the
  send path, pre-send check in the tool). Assessed and rejected earlier: mailpeek (Vue) and Mailpit (SMTP
  capture — we don't send). None built.
- **Equal-height card columns** — built 21 Sept as matched rows (B7), then made moot the same day by the
  one-offer-per-row decision. Button alignment across cards no longer arises. Deleted 22 Sept.
- **BCH / salary-sacrifice processing fee** — the £299.99 fee is forced on **PCH only** (first stage); decide
  BCH/salsac handling.

**Remaining build-order:** step 8 stubs + `evolution.md` (low value). **Owed by others / parked:** Emma —
approved compliance wording (then publish a real template to replace the placeholder) + the retention period;
IT — the two 123-Reg records for `offers.dreamlease.co.uk` (runbook C8; the Entra app is done); Matt — runbook
Parts B and C, the deploy, the placeholder-template correction (`apps/api/scripts/fix-placeholder-template.sql`),
the Firecrawl secret and confirming the Workers Paid plan; Tawk webchat (parked, renewals-only stage one).

## B10. Testing & verification
- `pnpm test` — **247 tests** (29 Sept: adapters 93 with the ended-offer message, api 96 with direct preview links, the use-case note and the remove/restore rule). Before that, 242 (28 Sept): schema 23, render 35 (incl. the intro-derived preheader), adapters 92, api 92
  (templates: who may read and write, `COMPLIANCE_EMAILS`, `/me`'s `complianceApprover`; the placeholder template
  seeded without an approver and replaced by compliance's first publish; the web app served on the tool host only;
  security: 7, the cross-site guard and safe error logs)
  (library: 10, incl. `withStoredBrochure`; campaigns: the `salespersonTag` unit test and `utm_term` on the stored
  campaign, on the `/r` destination and on the footer link; OpenAPI: 7, incl. the served-vs-documented drift guard). The adapter suite replays 18 recorded
  manufacturer sites through the brochure finder at zero credits (added 21 Sept: Polestar 2, the European fallback;
  Renault 4 and Geely EX2, the two misses of that afternoon; Toyota C-HR, Škoda Kodiaq and Hyundai Kona from the
  finder-1.4 sweep). `packages/adapters/scripts/finder-sweep.mts` runs the finder LIVE over a list of cars (real
  credits) and is how a change to the finder is proven. `apps/api` runs inside workerd with
  real local D1/R2/Images; adapter tests use the wasm HTMLRewriter.
- `pnpm typecheck` clean (incl. `apps/web`); `apps/web` builds. `packages/render/scripts/diff-reference.ts` guards markup
  fidelity. The test suites assert no CAP-ID leak (CI: `ci.yml` + `security.yml`, since 24 Sept). `.dev.vars` is git-ignored and must never be committed.

## B11. Key files index
- Model & guard: `packages/schema/src/model.ts`, `capid.ts`, `text.ts` (the site's HTML entities, decoded at lookup and again wherever an offer reaches the server)
- Rendering: `packages/render/src/render.ts`, `cards.ts`, `viewmodel.ts`, `layout.ts`, `links.ts`
- Adapters: `packages/adapters/src/url/*`, `firecrawl/`, `brochure/` (`finder.ts`, `operate.ts`, `harvest.ts`, `ensure.ts`), `scripts/finder-sweep.mts`
- Worker: `apps/api/src/index.ts` (routes + Cron), `campaigns.ts`, `profile.ts`, `templates.ts`,
  `suppressions.ts`, `retention.ts`, `roles.ts`, `files.ts`, `brochures.ts`, `lookup.ts`, `library.ts`,
  `hosted.ts`, `tracking.ts`, `middleware/access.ts`, `db/schema.ts`, `openapi.ts` (the API described),
  `safe-log.ts` (every error log line), `ui.ts` (the web app on the tool host), `local.ts` (is this wrangler dev on
  the laptop); `apps/api/scripts/fix-placeholder-template.sql` (the one-off production correction of 28 Sept)
- Web: `apps/web/src/App.tsx` (header portrait, `addFromLibrary`), `Compose.tsx` (incl. `repriceCopied`, the resizable
  columns), `Campaigns.tsx`, `Library.tsx`, `Register.tsx`, `Suppressions.tsx`, `Templates.tsx`, `api.ts`
  (incl. `currentBrochure`), `styles.css`; `apps/web/vite.config.ts` (proxy + tunnel `allowedHosts`)
- Config: `apps/api/wrangler.jsonc`, `config/` (`badges.json`, `admins.json`, `compliance.json`,
  `library-shelves.json`), `.claude/launch.json` (the dev servers for the desktop app)
- Runbooks: `docs/it-runbook-sign-in.md` (Entra + Cloudflare Access sign-in, revised 24 Sept; Parts B and C, the
  addresses, revised 28 Sept)

## B12. How to extend

How to grow the app without refactoring it. The shape stays: the Zod model at the centre, one adapter per outside
system, one API, and a UI that only calls the API.

- **Add an API route.**
  1. Validate its input with a named, exported Zod schema.
  2. Add the route to `OPERATIONS` in `apps/api/src/openapi.ts` (with the schema registered). The drift test fails until you do.
  3. Add a contract test in `apps/api/test/`.
  4. Writes go on the `api` sub-app, where the cross-site guard covers them; public routes stay GET-only. A test of
     any non-JSON write (an upload, a bodyless POST or DELETE, a raw text body) sends `SAME_ORIGIN`
     (`test/same-origin.ts`), as the browser does, or it gets 403.
- **Connect a new outside system** (monday.com, Mautic, a CRM…).
  1. Give it its own adapter in `packages/adapters/src/<system>/`: a typed interface, the implementation and contract tests with fixtures validated by `@offer-mailer/schema`.
  2. No adapter imports another; the API wires them.
  3. A new delivery route is an `OfferOutput` like `m365` (B13); monday.com is the customer record, not a send route (`evolution.md` decision 6).
- **Add a field to the model.**
  1. Add it to `packages/schema` as optional (or with a default) so stored JSON snapshots still parse.
  2. D1 changes are additive migrations only (`pnpm db:generate`). Matt applies remote migrations.
  3. Keep `assertNoCapId()` coverage for anything persisted.
- **Release WhatsApp.** Set `WHATSAPP_LIVE` to true in `apps/web/src/Compose.tsx` and deploy: the number field, the CTA and the signature link come back.
- **Add a rule, list or wording.** Put it in `config/` (like `badges.json`, `library-shelves.json`), not in code.
- **Change who approves the compliance wording.** Use the exact sign-in address from Zero Trust → Team & Resources → Users (Emma signs in as `emma@dreamlease.co.uk`; an assumed `emma.airey@` left her without the Templates tab until PR #12). Edit `config/compliance.json` and deploy, or set
  `COMPLIANCE_EMAILS` for a temporary deputy. Never grant it through `admins.json`: admins read templates, they do not
  approve them.
- **Serve another staff page.** Put it in the web app (a new view in `App.tsx`), not in a new host: everything under
  `/app/` is already behind Access on the tool host and absent everywhere else. A new public (customer) route is a
  GET on the Worker, listed in `OPERATIONS`, and must not rely on Access.
- **Let another app, Make or an AI agent use it.** `/api/openapi.json` describes the API, but **machine sign-in is not supported yet**.
  - `requireAccess` needs an `email` claim. A Cloudflare Access service-token JWT carries only `common_name`, so a machine gets a 401 (it fails closed).
  - Enabling machine access is a deliberate change: map a named service token to an identity and a role (for `createdBy` and the promotions register), with a contract test.
  - It must also get past the cross-site guard, which runs first: for example, skip `csrf()` only for a request carrying a verified **service-token** JWT (`common_name`, no `email`; another website cannot forge that header). Never skip it for any valid JWT: Access attaches one to every browser request too, so that would switch the guard off for everyone. Test a multipart upload by a machine.
  - **Never loosen the email check to make a machine work.**
- **Known follow-ups** (built-to-last gaps, 24 Sept):
  1. Move the hand-checked request bodies to Zod. They are marked `x-validated-by: handler`: `/me/sender`, `/me/photo`, `/offers/lookup`, `/brochures/ensure`, `/brochures/accept`, `/brochures/manual` and `/offers/library/:id/promote`.
  2. Type the responses.
  3. ~~Decide whether `/api/dev/preview` should stay in production.~~ Decided by Matt, 24 Sept: it answers only on this
     laptop (`src/local.ts`) and returns 404 on the live site, so a link can't publish a fixture page with made-up prices.
  4. Machine sign-in (Access service tokens mapped to an identity and role, and let through the cross-site guard), when Make or an agent first needs to call the API.

## B13. Sending from the salesperson's own mailbox (Phase 1, 29 Sept 2026; built, not yet deployed)

The plan and the decisions are `evolution.md` §6; IT's side is `it-runbook-sign-in.md` Part D. As built:

- **Connect Outlook** (`apps/api/src/mail.ts`). `GET /api/mail/connect` (a browser navigation) seals the OAuth state,
  the PKCE verifier and the signed-in email into an HttpOnly, SameSite=Lax cookie on `/api/mail` (10 minutes) and
  redirects to Microsoft's authorize endpoint for the tenant, with the five delegated scopes and `login_hint`.
  Microsoft returns the browser to `GET /api/mail/callback` (behind Access like the rest of `/api`): the state, the
  cookie and the Access user must all match; the code is redeemed with the verifier; `GET /me` must be the Access
  user (mail or UPN, case-insensitive), or nothing is stored (`?outlook=mismatch`). The refresh token is stored in
  `mail_connections`, encrypted (`mail-crypto.ts`). The browser goes back to the web app with `?outlook=<outcome>`
  (`/app/` on the tool host, `/` on localhost:5173). The return address is **configuration** (`MAIL_REDIRECT_URI`),
  never taken from the request: the Vite proxy rewrites the Host header. `GET /api/mail/status` reads D1 only.
- **The adapter** (`packages/adapters/src/m365/`). A Microsoft client (authorize URL, code redemption, refresh,
  `/me`, `/me/sendMail` with `saveToSentItems: true` and never a `from`) and the `m365` `OfferOutput`. Every
  Microsoft answer maps to one of five outcomes: reconnect, app_credential, throttled (with Retry-After), rejected,
  unavailable. Contract tests against a stand-in for Microsoft (`packages/adapters/test/m365.test.ts`).
- **Send** (`apps/api/src/send.ts`). `POST /api/campaigns/{id}/send { to, firstName? }`: the creator only, with their
  own signature; set up, allowed (`config/mail.json`: dreamlease.co.uk) and connected, else 503 / 403 / 428 before
  any check runs. Then the email is **re-rendered on the server** (`renderForSend` in `campaigns.ts`: the stored
  campaign, its own template, the brochure records, the first name for the greeting; a brochure that no longer exists
  is left out so the checks can name it), the pre-send checks run, the campaign is **reserved** (`claimSend`: status
  column `sending`, a conditional update, so a double click cannot send twice), the stored permission is opened and
  renewed (the rotated refresh token is stored), `/me` is checked again, Graph accepts the email (202), and `markSent`
  writes `status: sent`, `sentAt`, `sentVia: 'm365'` and `sentBy` to the columns and the JSON together (tried twice;
  if both fail the answer is still "sent", with `recordPending`). **A send is never repeated by the tool:** the
  reservation is released only when Microsoft certainly did not get the email (a failure before the send, or a clear
  4xx refusal); when the send itself gets no clear answer (network error, 5xx, not 202: code `uncertain`) it stays
  reserved for good and the salesperson is told to look in Sent Items and, if it is not there, create the campaign
  again. Nothing after the 202 (bookkeeping included) can undo the reservation. 422 lists the failed checks; 428 asks
  to connect (or reconnect: a 401 or 403 from Microsoft, or a permission that cannot be opened because the key
  changed; the connection is deleted); 429 carries Retry-After; 409 means sent or possibly sent. On the local sign-in
  bypass (no Access), Send accepts only a page on this PC (`Origin` localhost), so a shared dev tunnel cannot send
  from the dev user's mailbox; `/mail/connect` refuses a cross-site start (`Sec-Fetch-Site`).
- **The pre-send checks** (`apps/api/src/presend.ts`, pure; `test/presend.test.ts` rule by rule): wording approved by
  a compliance approver (the placeholder has none) and still approved; every offer priced (both nets for salary
  sacrifice); in date (UK date); still on the website (looked up within 24 hours, else looked up again, and the
  price unchanged; a url offer priced by an older `PRICING_VERSION` is looked up again however recent); pictures, photo and PDF brochures present in R2, other brochure pages not 404/410; every tracked
  link in the stored link map; subject and message; the HTML under `maxEmailKb` (90 KB: Gmail clips at about 102 KB,
  which would hide the compliance wording); no CAP ID; the customer's address valid and not suppressed (Send only).
  `POST /api/campaigns/{id}/checks` runs them without the address: Copy for Outlook calls it before copying.
- **Web** (`Compose.tsx`): step 3 Connect / Disconnect Outlook (Connect opens its own window, so the campaign being
  written survives the Microsoft sign-in; the result comes back by `postMessage` and a status poll) and the
  `?outlook=` message; step 6 ("Send") the customer's email (empty for every new campaign) and Send, "Sent from your
  mailbox at 10:42", failed checks in plain words; Copy for Outlook below as the backup (the clipboard write starts
  inside the click, the content arriving once the checks pass, for Safari and Firefox). Any edit after Create drops
  the created campaign ("create it again"), because Send and Copy use the stored campaign. When the Send app is not
  set up, or for a salsac.co.uk sign-in, step 6 is the old Copy flow.
- **Settings**: vars `MAIL_TENANT_ID`, `MAIL_CLIENT_ID`, `MAIL_REDIRECT_URI` (`wrangler.jsonc`; `pnpm dev` and
  `dev:live` pass the localhost return address); secrets `MAIL_CLIENT_SECRET`, `MAIL_TOKEN_KEY`. Any missing = not set
  up. Rules in `config/mail.json` (who may send, the size limit, the 24-hour offer rule).
- **Privacy**: the customer's address is used for the one send and never stored or logged (a test searches every
  campaign and connection row for it). The salesperson's sent copy is in their Sent Items under DreamLease's
  Microsoft 365 retention.
