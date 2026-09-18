# DreamLease Offer Mailer — Solution Design & System Architecture

**Status:** current as of 16 Sept 2026 (end of session 3). This is the authoritative technical design
document. For product requirements see `dreamlease-offer-mailer-brief.md` (v1.1); for the email-markup rules
see `offer-mailer-implementation-notes.md`; for the session build log see `status-2026-09-16.md`; for how to
resume see `PICKUP-PROMPT.md`. The deferred brochure-discovery redesign is briefed in
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
2. **Configure & assemble.** Rep picks the audience, layout, up to six offers, writes the intro/subject, picks
   the green-button CTA + optional secondary contact links, optionally attaches a brochure, previews live.
3. **Create.** The server assembles a `Campaign` (server-owned identity/slug/tracking/template/compliance),
   strips any recipient PII, validates, renders, writes the hosted page to R2, stores a snapshot in D1, and
   returns the email HTML/text for Copy-for-Outlook plus the hosted URL.
4. **Deliver.** Copy-for-Outlook (clipboard `text/html` + `text/plain`), or the hosted link. Graph "create
   draft in Outlook" is designed but **parked** (needs IT's Entra app). A human sends.
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
  what was checked and can upload, paste a link, accept the official page, or send without. See
  `brochure-finder-brief.md` and `status-2026-09-18.md`.
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
   persisted object; CI greps for leaks. No raw scraped HTML is ever persisted (24 h cache = parsed only).
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
`/api/*` returns **503** (fails closed). **Domain note:** `mailer.` is already occupied (see `status` §7 /
memory); a free Cloudflare-served subdomain is needed — proposed `offer-mailer.` / `offers.`.

## B2. Monorepo layout (pnpm workspaces)
| Package | Responsibility |
|---|---|
| `packages/schema` | Zod offer model + `assertNoCapId`. The shared contract. |
| `packages/adapters` | Source & output adapters, pure: URL lookup (normalise → parse → pricing → buildOffer), Firecrawl client, brochure finder/harvest/manual/ensure. No adapter imports another. |
| `packages/render` | `render(campaign, template)` — the sole HTML producer. v5 markup as template functions; four layouts; `diff-reference.ts` fidelity check; `MARKUP_VERSION`. |
| `packages/design-system` | Vendored DreamLease design system (`dl-*` React components, tokens, Sofia Pro), consumed as source. |
| `apps/api` | The Cloudflare Worker (Hono): API, hosted pages, redirects, files, static assets, the retention Cron. |
| `apps/web` | Vite + React tool UI: Compose / Campaigns / Library / Register / Suppressions / Templates (admin). Dev-only today; served from the Worker in prod later. |

## B3. Runtime & bindings (Cloudflare, account `9b8d051…`, Paid plan)
- **Worker** `offer-mailer` (`apps/api/wrangler.jsonc`), `nodejs_compat`, observability on; static assets from
  `./public` via `ASSETS` (`/a/*`); **Cron trigger** `0 3 * * *` (retention).
- **D1** `offer-mailer` (`32d1b987-…`, WEUR), binding `DB`, Drizzle ORM, migrations in `apps/api/migrations`.
- **R2** (WEUR): `offer-mailer-images` (`IMAGES`), `offer-mailer-hosted` (`HOSTED`), `offer-mailer-brochures`
  (`BROCHURES`).
- **Images** binding `TRANSFORM` (vehicle → 1200px JPEG; headshot → 256px square).
- **Access** — `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` gate prod; empty locally.
- **Vars/secrets** — `FIRECRAWL_API_KEY` (secret); optional `ADMIN_EMAILS`, `RETENTION_CAMPAIGN_DAYS`;
  locally `.dev.vars` (git-ignored, `DEV_USER_EMAIL`).

## B4. Data model & storage
### D1 tables (`apps/api/src/db/schema.ts`) — JSON snapshots validated by `@offer-mailer/schema`
| Table | Holds | PII |
|---|---|---|
| `campaigns` | Campaign snapshot + slug, template id/version, `createdBy`, timestamps, `links` map | rep email + sender; **no recipient** (stripped at save) |
| `offers` | Saved offer library | rep email |
| `templates` | Compliance templates (blocks, footer, markup/version, status, approvedBy/At) | approver email |
| `brochures` | Brochure metadata (PDF bytes are in R2) | none |
| `brochure_searches` | Latest completed brochure search per vehicle: outcome + what was checked (7-day negative memory) | rep email |
| `senders` | Rep profile (name/phone/WhatsApp/booking/secondary + headshot URL), keyed by email | rep business data |
| `clicks` | Click/view log: coarse uaClass + timestamp | **none — no IP/UA** |
| `suppressions` | Opt-out **emails (plain text)** + addedBy/at/note | recipient email (lawful basis; admin-removable) |
| `lookup_cache` | 24 h parsed lookup results — never raw HTML; purged daily | none |

### R2 objects
| Bucket | Holds | Key | Served |
|---|---|---|---|
| `offer-mailer-images` | vehicle images + rep headshots | `vehicles/<sha256>.jpg`, `headshots/<sha256>.jpg` | `/f/vehicles/*`, `/f/headshots/*` |
| `offer-mailer-hosted` | rendered hosted offer pages | `c/<slug>.html` | `/c/<slug>` (noindex, expiring) |
| `offer-mailer-brochures` | brochure PDFs | `brochures/<sha256>.pdf` | `/f/brochures/*`, `/b/<id>` |

### Limits & residency
- **D1:** 10 GB per database (Paid); live usage ~120 KB — never a concern. (Free-tier daily row cap is removed
  by the Workers Paid plan.)
- **R2:** no total cap, per-GB-month billing (10 GB/mo free); per-object 5 GiB single / 5 TiB multipart.
- **Residency:** D1 + R2 in **WEUR (EU)**. Cloudflare is the processor (standard DPA applies).

## B5. Routing surface (`apps/api/src/index.ts`)
**Public (no login):** `/health` · `/c/:slug` · `/f/*` · `/b/:id` · `/r/:slug/:link` · `/a/*`.
**Behind Access (`/api/*`):** `/me`, `/me/photo`, `/me/sender` · `/offers/lookup`, `/offers/library` ·
`/brochures/ensure`, `/brochures/accept`, `/brochures/manual` · `/campaigns*`, `/register`, `/register.csv` ·
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
`scripts/diff-reference.ts` — any non-data structural difference is a deviation, justified in the `cards.ts`
header. Auto layout: 1 single, 2 grid2, 3 stack, 4+ grid2; grid3 only when chosen. `MARKUP_VERSION` is bumped
when the markup changes in a way Emma should re-approve; templates pin the version they were approved against
(campaigns pin `compliance.approvedWordingVersion`).

Two data-side display rules live in the viewmodel (not markup, so the reference is untouched): **PCH
(personal) cards always show the standard £299.99 processing fee** even when the site returned none (BCH/salsac
unchanged — first stage); and **every card in a multi-offer campaign shows the same, even number of stat
tiles** (the common count across the offers, floored to even) so the cards read as a matched set — a single
hero keeps its natural count.

## B8. External dependencies
- **Firecrawl** — the only metered/external service (brochure discovery/fetch; `fetchFile` via `rawBase64`
  past bot protection). Sees the URLs we scrape transiently; brochure PDFs land in our R2. **No customer PII.**
- **Microsoft Entra / 365** — identity only. Graph draft parked.
- **Parked/deferred:** Tawk.to webchat (renewals-only stage one, `status` §7); the custom-domain/prod-URL
  setup (`mailer.` occupied — `status` §7 / memory); Graph draft (IT Entra app); Google Sheets register export.

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

**PII plan: complete** (items 1–4). Build-order steps 1–7 done.

**Queued / open decisions (from the 16 Sept UX pass — pick up next session):**
- **Badge control (rep-editable).** Reps want website-level control over the offer-card badge/tags — a
  Show-badge toggle, an editable badge with two-line `\n`, a tags editor with a ★ "hot" tag. **One decision
  first (touches rule 3): fixed approved list vs free text.** Recommended: **free text but recorded verbatim
  in the promotions register** (like intro/subject already are), with an optional claim-word denylist. Not
  built. Today badges are auto-derived from the vehicle page only (no rep control), which is why a car the
  site didn't flag (e.g. the Golf) shows no pill.
- **Email cross-client validation.** Assessed mailpeek (Vue — no) and Mailpit (SMTP capture — we don't send).
  Recommended building natively: (1) a **caniemail-based CSS compatibility check** in the test suite; (2)
  **mobile + dark preview toggles** in Compose; (3) **Litmus / Email on Acid** (paid) for real Outlook-desktop
  sign-off. None built.
- **Equal-height card columns / button alignment** — the hard email-layout item (no flexbox in Outlook); per
  the working method, build a diagnostic `.eml` and check in Outlook + mobile before touching the reference.
  The stat + fee fixes already removed most raggedness.
- **BCH / salary-sacrifice processing fee** — the £299.99 fee is forced on **PCH only** (first stage); decide
  BCH/salsac handling.

**Remaining build-order:** step 8 stubs + `evolution.md` (low value). **Owed by others / parked:** Emma —
approved compliance wording (then publish a real template to replace the placeholder) + the retention period;
IT — Access + a Cloudflare-served subdomain (parked; `mailer.` occupied) + the Graph Entra app; Matt — Firecrawl
secret + Workers Paid plan; the prod deploy; Tawk webchat (parked, renewals-only stage one).

## B10. Testing & verification
- `pnpm test` — **172 tests**: schema 18, render 31, adapters 64, api 59. The adapter suite replays 12 recorded
  manufacturer sites through the brochure finder at zero credits. `apps/api` runs inside workerd with
  real local D1/R2/Images; adapter tests use the wasm HTMLRewriter.
- `pnpm typecheck` clean (incl. `apps/web`); `apps/web` builds. `scripts/diff-reference.ts` guards markup
  fidelity. CI greps for CAP-ID leaks. `.dev.vars` is git-ignored and must never be committed.

## B11. Key files index
- Model & guard: `packages/schema/src/model.ts`, `capid.ts`
- Rendering: `packages/render/src/render.ts`, `cards.ts`, `viewmodel.ts`, `layout.ts`, `links.ts`
- Adapters: `packages/adapters/src/url/*`, `firecrawl/`, `brochure/`
- Worker: `apps/api/src/index.ts` (routes + Cron), `campaigns.ts`, `profile.ts`, `templates.ts`,
  `suppressions.ts`, `retention.ts`, `roles.ts`, `files.ts`, `brochures.ts`, `lookup.ts`, `library.ts`,
  `hosted.ts`, `tracking.ts`, `middleware/access.ts`, `db/schema.ts`
- Web: `apps/web/src/App.tsx`, `Compose.tsx`, `Templates.tsx`, `Suppressions.tsx`, `api.ts`
- Config: `apps/api/wrangler.jsonc`, `config/` (badges, admins)
