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
   configuration options (the "chips"). Cached 24 h. Prices are not in the page HTML. The **configured terms
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
- **Brochures**: the finder searches, verifies and attaches by itself — the manufacturer's UK PDF (hosted by us),
  or its own web brochure / price & spec page as a link; no allowlist, no picking. When nothing verifies the rep sees
  what was checked and can upload, paste a link, accept the official page, or send without. **Two tiers
  (21 Sept):** the UK edition is the target; when none verifies, the manufacturer's own **European brochure in
  English** is attached instead, stored with `market: 'eu'`, titled "European edition" and flagged to the rep
  (never a European price guide, never the rest of the world). **finder-1.3 (21 Sept)** also reads the PDFs a page offers through a button (addresses held only in the page’s own data), opens a numeric model’s file when the name leaves the make out ("R4-eBrochure.pdf"), and keeps "linked from the official site" when the search had already found the same file. See `brochure-finder-brief.md`,
  `status-2026-09-18.md` and `status-2026-09-21.md` §3.
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
- **Still open:** text **colour and font size arrive flattened** (the 28px red price and the red make name arrive
  black and body-sized, in Gmail and Outlook alike). Whether that is Outlook's paste option ("merge formatting")
  or its sanitiser is not known; it needs the as-received source (Gmail → Show original). Not fixed.

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
| `packages/adapters` | Source & output adapters, pure: URL lookup (normalise → parse → pricing → buildOffer), Firecrawl client, brochure finder / harvest (which also holds the manual upload-or-paste path) / ensure. No adapter imports another. |
| `packages/render` | `render(campaign, template)` — the sole HTML producer. v5 markup as template functions (`cards.ts`, `render.ts`), with the recorded deviations of B7; four layouts, two of them offered; `match.ts` + `measure.ts` (row height matching); `diff-reference.ts` fidelity check; `MARKUP_VERSION`. |
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
| `brochure_searches` | Latest completed brochure search per vehicle: outcome + what was checked. A "nothing found" is remembered 7 days, but never a failed search and never one made under an older `FINDER_VERSION` (a rules change re-runs, and re-pays for, those searches) | rep email |
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
`/brochures/ensure`, `/brochures/accept`, `/brochures/manual`, `/brochures/current` (the stored copy, no search) · `/campaigns*`, `/register`, `/register.csv` ·
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
header. **Auto layout is one offer per row: 1 → single (hero), 2+ → stack** (Matt, 21 Sept; grid2 / grid3 still
render for a stored campaign that names one, but the tool no longer offers them). `MARKUP_VERSION` is bumped
when the markup changes in a way Emma should re-approve; templates pin the version they were approved against
(campaigns pin `compliance.approvedWordingVersion`).

Two data-side display rules live in the viewmodel (not markup, so the reference is untouched): **PCH
(personal) cards always show the standard £299.99 processing fee** even when the site returned none (BCH/salsac
unchanged — first stage); and **every card in a multi-offer campaign shows the same, even number of stat
tiles** (the common count across the offers, floored to even) so the cards read as a matched set — a single
hero keeps its natural count. A third (21 Sept): when the attached brochure is the manufacturer's **European
edition** (`Brochure.market === 'eu'`), the small print adds "This is the manufacturer's European brochure;
specification, equipment and prices may differ from UK models." (grid3: a shared-footnote variant).

**Deviations from the v5 reference, all for the paste path of A5** (recorded in the header of `cards.ts`;
`diff-reference` reports 22 lines: 8 pre-date 21 Sept (2 the logo width, 6 the third hero pill) and 14 are the inline-block pills (10) and the stack card’s image column (4); the fluid wrapper sits outside the sections the script compares). **`MARKUP_VERSION` was not bumped for them (still 2)**, so templates approved against it — including the
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
- (Earlier, 14 Sept) up to three pills on the hero where the reference has two; logo 98px wide.

**Matched rows** (`match.ts`, `measure.ts`): when a grid IS rendered, the cards in each row come out the same
height — a card reserves the badge row, brochure row and extra text lines its row-mate has, using empty cells
and `min-height` only. `measure.ts` estimates where Arial text wraps without a browser (15 of 15 strings agreed
with Chrome). Like-for-like cards reserve nothing and render the reference exactly. With one offer per row this
is dormant; the grid code and it are candidates for deletion once the stacked layout is confirmed in both clients.

## B8. External dependencies
- **Firecrawl** — the only metered/external service. Two jobs: the **fallback HTML fetch for the vehicle lookup**
  when the direct fetch fails (so it also sees dreamlease.co.uk offer URLs; wired only when the key is set, so
  inactive in production today), and brochure discovery/fetch (`fetchFile` via `rawBase64`
  past bot protection). Sees the URLs we scrape transiently; brochure PDFs land in our R2. **No customer PII.**
- **Microsoft Entra / 365** — identity only. Graph draft parked.
- **Parked/deferred:** Tawk.to webchat (renewals-only stage one; parked in `status-2026-09-16.md` §7, design in
  `status-2026-09-15.md` §7); the custom-domain/prod-URL setup (`mailer.` occupied — `status-2026-09-16.md` §7 / memory); Graph draft (IT Entra app); Google Sheets register export.

## B9. Build status & roadmap (brief §8.2)
| Step | State |
|---|---|
| 1 Scaffold, schema, D1, Worker, Access, deploy | Done, deployed |
| 2 `render()`, four layouts, hosted page | Done |
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
- **Flattened text colour and size on the paste path** (A5) — needs the as-received source before it can be fixed.
- **Small print reads before the offer on a phone** — in the stack card it sits under the image; proposed: move it
  below the button. Not built (awaiting Matt).
- **Confirm the stacked layout in Gmail and Outlook mobile**, then delete the grid code (`halfCard`,
  `compactCard`, `match.ts`, `measure.ts`) and the reference's grid sections.
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
  one-offer-per-row decision. Button alignment across cards no longer arises.
- **BCH / salary-sacrifice processing fee** — the £299.99 fee is forced on **PCH only** (first stage); decide
  BCH/salsac handling.

**Remaining build-order:** step 8 stubs + `evolution.md` (low value). **Owed by others / parked:** Emma —
approved compliance wording (then publish a real template to replace the placeholder) + the retention period;
IT — Access + a Cloudflare-served subdomain (parked; `mailer.` occupied) + the Graph Entra app; Matt — Firecrawl
secret + confirming the Workers Paid plan; Tawk webchat (parked, renewals-only stage one).

## B10. Testing & verification
- `pnpm test` — **194 tests**: schema 18, render 37, adapters 80, api 59. The adapter suite replays 15 recorded
  manufacturer sites through the brochure finder at zero credits (added 21 Sept: Polestar 2, the European fallback;
  Renault 4 and Geely EX2, the two misses of that afternoon). `apps/api` runs inside workerd with
  real local D1/R2/Images; adapter tests use the wasm HTMLRewriter.
- `pnpm typecheck` clean (incl. `apps/web`); `apps/web` builds. `packages/render/scripts/diff-reference.ts` guards markup
  fidelity. The test suites assert no CAP-ID leak (there is no CI pipeline yet). `.dev.vars` is git-ignored and must never be committed.

## B11. Key files index
- Model & guard: `packages/schema/src/model.ts`, `capid.ts`
- Rendering: `packages/render/src/render.ts`, `cards.ts`, `viewmodel.ts`, `layout.ts`, `links.ts`, `match.ts`, `measure.ts`
- Adapters: `packages/adapters/src/url/*`, `firecrawl/`, `brochure/`
- Worker: `apps/api/src/index.ts` (routes + Cron), `campaigns.ts`, `profile.ts`, `templates.ts`,
  `suppressions.ts`, `retention.ts`, `roles.ts`, `files.ts`, `brochures.ts`, `lookup.ts`, `library.ts`,
  `hosted.ts`, `tracking.ts`, `middleware/access.ts`, `db/schema.ts`
- Web: `apps/web/src/App.tsx`, `Compose.tsx`, `Templates.tsx`, `Suppressions.tsx`, `api.ts`
- Config: `apps/api/wrangler.jsonc`, `config/` (badges, admins)
