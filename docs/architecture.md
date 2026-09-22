# DreamLease Offer Mailer — Solution Design & System Architecture

**Status:** current as of 21 Sept 2026 (session 5; production Worker v0.5.0). This is the authoritative technical
design document. For product requirements see `dreamlease-offer-mailer-brief.md` (v1.1, with an as-built log in
§9a); for the email-markup reference see `offer-mailer-implementation-notes.md` (and the deviations from it in
B7); for the build log see `status-2026-09-21.md` (`-09-18`, `-09-16`, `-09-15`, `-09-14` are history); for how
to resume see `PICKUP-PROMPT.md`. Brochure discovery (the finder) is designed and evidenced in
`brochure-finder-brief.md`. Where this document and the code disagree, the code wins — fix this document.

---

# Part A — Solution Design

## A1. What it is
An internal, FCA-aware tool. A DreamLease sales rep pastes a `dreamlease.co.uk` vehicle URL, assembles a
branded HTML email of one to six lease offers, and gets back **Outlook-ready HTML** (Copy-for-Outlook) plus a
**hosted web page** of the same offers. The Worker never sends email — a human always presses Send.

Three audiences / lease products, each with its own compliance wording and terms:
- **PCH** — personal contract hire (`personal`)
- **BCH** — business contract hire (`business`)
- **Salary sacrifice** (`salary_sacrifice`) — no initial payment; the price is all-in (finance + maintenance
  + insurance) and shown as two net figures (20% and 40% taxpayer).

## A2. Core flows
1. **Look up a vehicle.** Rep pastes a vehicle URL → normalise → HTMLRewriter page parse (identity/stats/
   image) → the site's own pricing JSON prices the chosen term/mileage/initial → returns an `Offer` plus the
   configuration options (the "chips"). Cached 24 h. Prices are not in the page HTML. The site HTML-encodes text
   even inside its script block ("Techno &#x2B; Comfort Range"), so names, stats and spec lines are entity-decoded;
   a cached result that still carries an entity is treated as stale. The same decoding runs again where an offer
   re-enters the server (library save and list, campaign preview and create), because a saved or open offer is a
   snapshot from before the fix (`packages/schema/src/text.ts`). The **configured terms
   are encoded into the offer URL**, so "View offer" opens the site pre-set to exactly what was quoted.
2. **Configure & assemble.** Rep picks the audience and up to six offers, writes the intro/subject, picks
   the green-button CTA + optional secondary contact links, optionally attaches a brochure, previews live.
   There is no layout to choose: one offer is the hero card, two or more are one offer per row (B7).
3. **Create.** The server assembles a `Campaign` (server-owned identity/slug/tracking/template/compliance),
   strips any recipient PII, validates, renders, writes the hosted page to R2, stores a snapshot in D1, and
   returns the email HTML/text for Copy-for-Outlook plus the hosted URL.
4. **Deliver.** Copy-for-Outlook (clipboard `text/html` + `text/plain`), or the hosted link. Graph "create
   draft in Outlook" is designed but **parked** (needs IT's Entra app). A human sends. **The paste into New
   Outlook is the real send path today, and Outlook rewrites what is pasted** — see A5; the email is built for
   what survives it.
5. **Track.** Every http link routes through `/r/<slug>/<linkId>` (logs a click, redirects); hosted-page views
   are logged. Stats per campaign. **No IP, no full user-agent.**

## A3. Feature inventory (built)
- **Compose**: URL lookup → re-pricing chips → live preview → create → Copy-for-Outlook + hosted link. The
  first offer **auto-renders the preview**; later edits keep the preview visible but **flag it out-of-date**
  (the rep presses Update preview) rather than blanking it; the Add button stays enabled and reads "Add
  offer" / "Add another offer".
- **Audience selector**: PCH / BCH / Salary sacrifice, driving compliance block, terms and (salsac) pricing.
- **Offer-button CTA**: one primary green button per campaign — *View offer · Call · WhatsApp · Email · Book a
  time to discuss* — each gated on the sender field it needs, with a rep-renamable label (≤30 chars).
- **Secondary contact links**: an optional rep-chosen row (*Call · WhatsApp · Email · Book a call*) under the
  signature, separate from the primary button, pruned to methods whose field is present.
- **Rep profile (persisted)**: portrait photo (upload/replace/remove) + editable contact details, remembered
  per rep and prefilled next time.
- **Brochures** (design in **B7b**): the finder searches, understands the manufacturer's site, operates the model's
  page and verifies what it finds; a verified **UK** brochure, price & spec guide or web brochure attaches by
  itself (our hosted PDF, or a link). No allowlist, no picking from a list. A manufacturer's **European brochure in
  English** is only ever **offered**: the rep uses it, puts their own in its place, or sends without. An official
  page that holds a protected file, a price-list hub and a request-a-brochure form are offered for one click too.
  When nothing is found the rep sees what was checked and can upload, paste a link, or send without.
- **European-edition small print**: when the attached brochure is a European edition the card's small print says
  so ("This is the manufacturer's European brochure; specification, equipment and prices may differ from UK
  models."); grid3's shared footnote has a variant. Wording is Matt's; Emma has not approved it yet.
- **One offer per row** (Matt, 21 Sept): a single offer renders as the hero card, two to six as stacked rows —
  image beside the details on a desktop, image above the details on a phone. The layout picker is gone.
- **Offer library**; **Campaigns** (list + per-campaign stats); **Promotions register** (master table + CSV).
- **Template admin (master-admin only)**: author the Emma-approved compliance templates, publish (self-
  approve), lock approved, new-version/retire. See A4 / B6.
- **Suppression register**: the opt-out list — add / check / view / CSV export; admin-only removal. See A4.

## A4. Security & compliance posture
### The four rules that never bend (see `CLAUDE.md`)
1. **Three layers, no leaks.** `packages/schema` is the model; source adapters produce `Offer`s, output
   adapters deliver a `Rendered` campaign; `render()` is the **only** place email/hosted HTML is produced;
   React never builds HTML; no adapter imports another.
2. **CAP IDs are never stored** — not in D1, R2 keys, filenames, logs or HTML. Images/brochures/headshots are
   content-addressed by the sha256 of our own bytes; only our R2 URL is kept. `assertNoCapId()` guards every
   persisted object, and the test suites assert that stored rows, link maps and rendered HTML carry no CAP ID or
   source image host (there is **no CI pipeline yet**: the check is `pnpm test`). No raw scraped HTML is ever
   persisted (24 h cache = parsed only).
3. **Compliance is locked.** Each template carries one approved compliance block per contract type; reps can't
   edit it; a campaign can't render against a template whose status is not `approved`. Rep-authored copy is
   recorded verbatim in the promotions register.
4. **Drafts only.** The Worker never sends email.

### PII posture — the plan is complete (16 Sept 2026)
- **Staff (rep) data is business contact data** — name, work email/phone/WhatsApp, booking link, signature
  photo — for the rep's own signature. Legitimate, minimal, expected; a signature headshot is not special-
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
- **Residual, by design:** rep-authored free text (campaign name, subject, intro) is kept as the FCA record
  and could contain a name if a rep types one — a training matter, not a schema one.

## A5. The real send path, and what the email is built for (21 Sept 2026)
**Scope (Matt, 21 Sept):** get it right in **Gmail (web + mobile app) and New Outlook (desktop + mobile)** first.
Classic Outlook (Word's engine) and the full client matrix in the implementation notes are **not** the current
target; the markup still carries the `[if mso]` ghost tables for it, untested.

**The send path rewrites the email.** A rep copies the HTML and pastes it into a New Outlook message. Matt's real
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
  Rep browser        │  /api/*  (behind Cloudflare Access → Entra SSO)                                          │
  (mailer.…)      ──►│    me/profile · lookup · brochures · campaigns · library · register                     │
                     │    templates (admin) · suppressions (remove=admin) · dev-preview                         │
  Customer browser   │  PUBLIC (no login):  /health · /c/:slug (hosted) · /f/* · /b/:id · /r/:slug/:link · /a/* │
  (offers.…)      ──►│  Cron (daily 03:00): scheduled() → retention/housekeeping                                │
                     └──────┬──────────────┬─────────────────┬──────────────────┬────────────────────────────┘
                          D1 (SQL)      R2 (objects)    Images (TRANSFORM)   Firecrawl (metered, external)
```
Two hosting surfaces on one Worker:
- **`mailer.dreamlease.co.uk`** — tool UI + `/api`, staff-only behind Cloudflare Access.
- **`offers.dreamlease.co.uk`** — hosted pages, redirects, images, brochures — public (noindex, expiring).

Until IT attaches the custom domains + Access, both run on `offer-mailer.matt-wilson-9b8.workers.dev` and
`/api/*` returns **503** (fails closed). **Domain note:** `mailer.` is already occupied (found 16 Sept: `status-2026-09-16.md` §4 and §7 /
memory); a free Cloudflare-served subdomain is needed — proposed `offer-mailer.` / `offers.`.

## B2. Monorepo layout (pnpm workspaces)
| Package | Responsibility |
|---|---|
| `packages/schema` | Zod offer model + `assertNoCapId`. The shared contract. |
| `packages/adapters` | Source & output adapters, pure: URL lookup (normalise → parse → pricing → buildOffer), Firecrawl client (search, map, scrape with page actions, raw file fetch), brochure finder / operate (the in-page script) / harvest (which also holds the manual upload-or-paste path and the accept paths) / ensure; `scripts/finder-sweep.mts` (live proof runs). No adapter imports another. |
| `packages/render` | `render(campaign, template)` — the sole HTML producer. v5 markup as template functions (`cards.ts`, `render.ts`), with the recorded deviations of B7; two layouts, hero and stacked (the grids were deleted 22 Sept); `diff-reference.ts` fidelity check; `MARKUP_VERSION`. |
| `packages/design-system` | Vendored DreamLease design system (`dl-*` React components, tokens, Sofia Pro), consumed as source. |
| `apps/api` | The Cloudflare Worker (Hono): API, hosted pages, redirects, files, static assets, the retention Cron. |
| `apps/web` | Vite + React tool UI: Compose / Campaigns / Library / Register / Suppressions / Templates (admin). Dev-only today; served from the Worker in prod later. |

## B3. Runtime & bindings (Cloudflare, account `9b8d051…`; the Workers Paid plan is the design assumption — Matt to confirm it is switched on, it cannot be seen from the repo)
- **Worker** `offer-mailer` (`apps/api/wrangler.jsonc`), `nodejs_compat`, observability on; static assets from
  `./public` via `ASSETS` (`/a/*`); **Cron trigger** `0 3 * * *` (retention).
- **D1** `offer-mailer` (`32d1b987-…`, WEUR), binding `DB`, Drizzle ORM, migrations in `apps/api/migrations`.
- **R2** (WEUR): `offer-mailer-images` (`IMAGES`), `offer-mailer-hosted` (`HOSTED`), `offer-mailer-brochures`
  (`BROCHURES`).
- **Images** binding `TRANSFORM` (vehicle → 1200px JPEG; headshot → 256px square).
- **Access** — `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` gate prod; empty locally.
- **Vars/secrets** — `FIRECRAWL_API_KEY` (secret; **not set in production**: `/health` reports `firecrawl:false`);
  optional `ADMIN_EMAILS`, `RETENTION_CAMPAIGN_DAYS`; locally `.dev.vars` (git-ignored, `DEV_USER_EMAIL`).

### Two ways to run the tool locally
| Command | Storage | Use it for |
|---|---|---|
| `pnpm dev` | local D1 / R2 / Images (miniflare) | building and the test suite. **Never for an email that will be sent**: its images and links point at production, which does not have them. |
| `pnpm dev:live` (`wrangler dev --remote`) | **production** D1 / R2 / Images | any real test send, and day-to-day use until Cloudflare Access exists. The local code renders; production serves the images, hosted page, redirects and brochures. It writes real production data (test campaigns land in the promotions register; wipe before go-live). |

Both take the dev sign-in from `.dev.vars`; the Vite UI (`pnpm --filter @offer-mailer/web dev`, port 5173) proxies to
whichever is on 8787. Production `/api` itself stays 503 until Access is configured.

## B4. Data model & storage
### D1 tables (`apps/api/src/db/schema.ts`) — JSON snapshots validated by `@offer-mailer/schema`
| Table | Holds | PII |
|---|---|---|
| `campaigns` | Campaign snapshot + slug, template id/version, `createdBy`, timestamps, `links` map | rep email + sender; **no recipient** (stripped at save) |
| `offers` | Saved offer library | rep email |
| `templates` | Compliance templates (blocks, footer, markup/version, status, approvedBy/At) | approver email |
| `brochures` | Brochure metadata (PDF bytes are in R2) | rep email (`createdBy`) |
| `brochure_searches` | Latest completed brochure search per vehicle: outcome, market, edition, and the trace (queries, pages opened, every document with how it was discovered, the action taken and why it was kept or dropped). Also what `/brochures/accept` acts on: an official page, a request form, or an offered European edition. A "nothing found" is remembered 7 days; a search that never reached a page of the official site (`exhausted: false`) only 1 day; never a failed search, and never one made under an older `FINDER_VERSION` (a rules change re-runs, and re-pays for, those searches) | rep email |
| `senders` | Rep profile (name/phone/WhatsApp/booking/secondary + headshot URL), keyed by email | rep business data |
| `clicks` | Click/view log: coarse uaClass + timestamp | **none — no IP/UA** |
| `suppressions` | Opt-out **emails (plain text)** + addedBy/at/note | recipient email (lawful basis; admin-removable) |
| `lookup_cache` | 24 h parsed lookup results — never raw HTML; purged daily | rep email (the cached `Offer` carries the `createdBy` of whoever looked it up first) |

### R2 objects
| Bucket | Holds | Key | Served |
|---|---|---|---|
| `offer-mailer-images` | vehicle images + rep headshots | `vehicles/<sha256>.jpg`, `headshots/<sha256>.jpg` | `/f/vehicles/*`, `/f/headshots/*` |
| `offer-mailer-hosted` | rendered hosted offer pages | `c/<slug>.html` | `/c/<slug>` (noindex, expiring) |
| `offer-mailer-brochures` | brochure PDFs | `brochures/<sha256>.pdf` | `/f/brochures/*`, `/b/<id>` |

### Limits & residency
- **D1:** 10 GB per database on the Paid plan; live usage ~200 KB — never a concern. (The Free-tier daily row cap
  goes away with Workers Paid.)
- **R2:** no total cap, per-GB-month billing (10 GB/mo free); per-object 5 GiB single / 5 TiB multipart.
- **Residency:** D1 + R2 in **WEUR (EU)**. Cloudflare is the processor (standard DPA applies).

## B5. Routing surface (`apps/api/src/index.ts`)
**Public (no login):** `/health` · `/c/:slug` · `/f/*` · `/b/:id` · `/r/:slug/:link` · `/a/*`.
**Behind Access (`/api/*`):** `/me`, `/me/photo`, `/me/sender` · `/offers/lookup`, `/offers/library` ·
`/brochures/ensure`, `/brochures/accept` (an official page, a request form, or the European edition the finder offered), `/brochures/manual`, `/brochures/current` (the stored copy, no search) · `/campaigns*`, `/register`, `/register.csv` ·
`/templates*` **(admin)** · `/suppressions`, `/suppressions.csv`, `/suppressions/check`,
`/suppressions/remove` **(remove = admin)** · `/dev/*`.
**Cron:** `scheduled()` → `runRetention()` + `recheckLinkedBrochures()` (a web / request brochure whose page is now 404/410 is superseded).

## B6. Authentication & authorization
- **Authentication** — Cloudflare Access with **Microsoft Entra ID** as IdP. Access stamps each request with a
  `Cf-Access-Jwt-Assertion`; `requireAccess()` (`middleware/access.ts`) verifies it against the team JWKS +
  `ACCESS_AUD`; the verified **email** becomes the user identity, used as `createdBy` everywhere. No passwords
  stored. Local dev: with `ACCESS_AUD` empty, `DEV_USER_EMAIL` is accepted; with it set the bypass is inert
  (misconfigured prod fails closed 503).
- **Authorization (roles, built — `roles.ts`)** — two roles, approver parked:
  - **Salesperson** — the default; uses the tool.
  - **Master admin** — template admin + admin-only actions; **self-approves** templates (rule 3's approved-
    gate stays; the admin flips `draft → approved`).
  Mapping: a **config allowlist** (`config/admins.json`), optionally extended by `ADMIN_EMAILS`, resolved by
  `roleFor(env, email)` (case-insensitive). `/me` returns the role so the web app branches views;
  `requireAdmin()` gates admin routes. Works off whatever email Access supplies — no Entra work needed to
  build/test, no rework when Entra lands.

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

**Deviations from the v5 reference, all for the paste path of A5** (recorded in the header of `cards.ts`;
`diff-reference` reports 82 lines: 8 pre-date 21 Sept (2 the logo width, 6 the third hero pill), 10 are the inline-block pills (6) and the stack card’s image column (4), and 64 are the name-before-picture reorder of 22 Sept (50 the stacked card, 14 the hero); the fluid wrapper sits outside the sections the script compares). **`MARKUP_VERSION` was not bumped for them (still 2)**, so templates approved against it — including the
seeded placeholder — keep rendering (`render()` refuses a mismatch); whether Emma should re-approve the changed
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

**When it runs** (`ensure.ts`): one current brochure per make/model, shared by every rep. A stored copy inside its
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

| Status | Attaches by itself? | What the rep gets |
|---|---|---|
| `verified_pdf` / `verified_web_brochure`, market `uk` | **Yes** | Our hosted PDF, or a link to the manufacturer's web brochure |
| the same with market `eu` (flag `european_offer`) | **No — offered** | Use it · open it first · use my own · search again · send without |
| `official_page_only`, `brochure_request` | No — offered | One click to link the official page / request form |
| `not_verified`, `search_failed` | No | What was checked; upload / paste; retry when it failed |

**After a find** (`harvest.ts`): the PDF is fetched directly, then through Firecrawl; it must be a real PDF of 40 MB or
less; stored under its own hash; a file its host will not release is downgraded to "official page only" and never
worked around. An accepted European edition is fetched and stored only at that moment, is titled "(European
edition)", and a copy another rep accepted arrives **unticked**. Manual upload / paste always works and becomes the
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

## B8. External dependencies
- **Firecrawl** — the only metered/external service. Two jobs: the **fallback HTML fetch for the vehicle lookup**
  when the direct fetch fails (so it also sees dreamlease.co.uk offer URLs; wired only when the key is set, so
  inactive in production today), and **brochure discovery** (B7b), which uses four of its endpoints: **Search**
  (2 credits), **Map** (1), **Scrape with page `actions`** to operate a page in Firecrawl's own browser (1), Scrape
  with the PDF parser to read a document's first four pages (4), and `fetchFile` via `rawBase64` to retrieve a file
  past bot protection (about 2). Typical search: 10–12 credits; cap 25. Sees the URLs we scrape transiently; brochure PDFs land in our R2. **No customer PII.**
- **Microsoft Entra / 365** — identity only. Graph draft parked.
- **Parked/deferred:** Tawk.to webchat (renewals-only stage one; parked in `status-2026-09-16.md` §7, design in
  `status-2026-09-15.md` §7); the custom-domain/prod-URL setup (`mailer.` occupied — `status-2026-09-16.md` §7 / memory); Graph draft (IT Entra app); Google Sheets register export.

## B9. Build status & roadmap (brief §8.2)
| Step | State |
|---|---|
| 1 Scaffold, schema, D1, Worker, Access, deploy | Done, deployed |
| 2 `render()`, layouts, hosted page | Done (hero and stacked; the grids were deleted 22 Sept) |
| 3 URL lookup, image pipeline, brochure harvest | Done (brochure discovery rebuilt as the finder, 18 Sept) |
| 4 Web app | Core built (dev-only) |
| 5 Graph draft, Copy-for-Outlook | Copy-for-Outlook done; Graph parked |
| 6 Redirects, click logging, stats | Done |
| 7 Template admin, approval, register, suppression | **Done** (register, template admin + self-approve, suppression list) |
| 8 Stubs & `evolution.md` | Not started (low value) |

**PII plan: complete** (items 1–4). Build-order steps 1–7 done. **Production is v0.5.0** (21 Sept): the finder's
European fallback and the European-edition small print are live. The one-offer-per-row render is in `main` and is
what `pnpm dev:live` renders, so it is in use without a deploy (production serves what was stored; it does not
re-render a campaign).

**Open from the 21 Sept test sends (in priority order):**
- **Flattened text colour and size on the paste path** (A5) — cause found 22 Sept: Outlook's Merge-formatting paste.
  The fix is the rep's paste mode (Keep source formatting), confirmed by Matt's real sends to Gmail and Outlook on
  22 Sept. The Copy for Outlook screen tells the rep (helper line under the button, 22 Sept).
- **Small print before the offer on a phone** — done 22 Sept (B7, deviation d): the stacked card now reads name,
  picture, price, button, small print. Confirmed by Matt's real sends to Gmail and Outlook, 22 Sept.
- **Grid code deleted** (22 Sept) once Matt confirmed the stacked layout in Gmail and Outlook: `halfCard`,
  `compactCard`, `ghostGrid`, `match.ts`, `measure.ts`, the grid tests and fixtures. The design reference keeps its
  grid sections; `diff-reference` no longer compares them.
- **Rendering assurance** (A5): certification on real clients + an automatic pre-send check. Proposed, not built.

**Queued / open decisions (from the 16 Sept UX pass — pick up next session):**
- **Badge control (rep-editable).** Reps want website-level control over the offer-card badge/tags — a
  Show-badge toggle, an editable badge with two-line `\n`, a tags editor with a ★ "hot" tag. **One decision
  first (touches rule 3): fixed approved list vs free text.** Today rule 3, the brief and the schema all say fixed list
  (`config/badges.json`). Free-text-but-recorded-in-the-register (with an optional claim-word denylist) was floated on
  16 Sept; it would mean rewriting rule 3, so it is Matt’s call, not a default. Not built. Today badges are auto-derived from the vehicle page only (no rep control), which is why a car the
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
IT — Access + a Cloudflare-served subdomain (parked; `mailer.` occupied) + the Graph Entra app; Matt — Firecrawl
secret + confirming the Workers Paid plan; Tawk webchat (parked, renewals-only stage one).

## B10. Testing & verification
- `pnpm test` — **214 tests**: schema 23, render 37, adapters 92, api 62. The adapter suite replays 18 recorded
  manufacturer sites through the brochure finder at zero credits (added 21 Sept: Polestar 2, the European fallback;
  Renault 4 and Geely EX2, the two misses of that afternoon; Toyota C-HR, Škoda Kodiaq and Hyundai Kona from the
  finder-1.4 sweep). `packages/adapters/scripts/finder-sweep.mts` runs the finder LIVE over a list of cars (real
  credits) and is how a change to the finder is proven. `apps/api` runs inside workerd with
  real local D1/R2/Images; adapter tests use the wasm HTMLRewriter.
- `pnpm typecheck` clean (incl. `apps/web`); `apps/web` builds. `packages/render/scripts/diff-reference.ts` guards markup
  fidelity. The test suites assert no CAP-ID leak (there is no CI pipeline yet). `.dev.vars` is git-ignored and must never be committed.

## B11. Key files index
- Model & guard: `packages/schema/src/model.ts`, `capid.ts`, `text.ts` (the site's HTML entities, decoded at lookup and again wherever an offer reaches the server)
- Rendering: `packages/render/src/render.ts`, `cards.ts`, `viewmodel.ts`, `layout.ts`, `links.ts`
- Adapters: `packages/adapters/src/url/*`, `firecrawl/`, `brochure/` (`finder.ts`, `operate.ts`, `harvest.ts`, `ensure.ts`), `scripts/finder-sweep.mts`
- Worker: `apps/api/src/index.ts` (routes + Cron), `campaigns.ts`, `profile.ts`, `templates.ts`,
  `suppressions.ts`, `retention.ts`, `roles.ts`, `files.ts`, `brochures.ts`, `lookup.ts`, `library.ts`,
  `hosted.ts`, `tracking.ts`, `middleware/access.ts`, `db/schema.ts`
- Web: `apps/web/src/App.tsx`, `Compose.tsx`, `Templates.tsx`, `Suppressions.tsx`, `api.ts`
- Config: `apps/api/wrangler.jsonc`, `config/` (badges, admins)
