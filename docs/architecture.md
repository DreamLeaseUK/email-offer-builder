# DreamLease Offer Mailer — Solution Design & System Architecture

**Status:** current as of 16 Sept 2026 (session 3). This is the authoritative technical design document.
For product requirements see `dreamlease-offer-mailer-brief.md` (v1.1); for the email-markup rules see
`offer-mailer-implementation-notes.md`; for session state / hand-off see `status-2026-09-15.md` and
`PICKUP-PROMPT.md`; the next major task is briefed in `brochure-finder-brief.md`. Where this document and
the code disagree, the code wins — fix this document.

---

# Part A — Solution Design

## A1. What it is
An internal, FCA-aware tool. A DreamLease sales rep pastes a `dreamlease.co.uk` vehicle URL, assembles a
branded HTML email of one to six lease offers, and gets back **Outlook-ready HTML** (Copy-for-Outlook) plus a
**hosted web page** of the same offers. The Worker never sends email — a human always presses Send.

Three audiences / lease products are supported, each with its own compliance wording and terms:
- **PCH** — personal contract hire (`personal`)
- **BCH** — business contract hire (`business`)
- **Salary sacrifice** (`salary_sacrifice`) — no initial payment; the price is all-in (finance + maintenance
  + insurance) and shown as two net figures (20% and 40% taxpayer).

## A2. Core flows
1. **Look up a vehicle.** Rep pastes a vehicle URL → the URL adapter normalises it, parses the page
   (HTMLRewriter) for identity/stats/image, calls the site's own pricing JSON to price the chosen
   term/mileage/initial, and returns an `Offer` plus the site's configuration options (the "chips"). Cached
   24 h. Prices are **not** in the page HTML.
2. **Configure & assemble.** Rep picks the audience, the layout, up to six offers, writes the intro/subject,
   picks the green-button CTA (and optional secondary contact links), optionally attaches a brochure, and
   previews live. The **configured terms are encoded into the offer URL** (`?offer=…&initialRental=…&
   contractLength=…&annualMileage=…`), so "View offer" opens the site pre-set to exactly what was quoted.
3. **Create.** The server assembles a `Campaign` (server-owned identity/slug/tracking/template/compliance),
   validates it, renders it, writes the hosted page to R2, stores a snapshot in D1, and returns the email
   HTML/text for Copy-for-Outlook plus the hosted URL.
4. **Deliver.** Copy-for-Outlook (clipboard `text/html` + `text/plain`), or the hosted link. Graph
   "create draft in Outlook" is designed but **parked** (needs IT's Entra app). A human sends.
5. **Track.** Every http link in the email routes through `/r/<slug>/<linkId>`, which logs a click and
   redirects; hosted-page views are logged. Stats surface per campaign. **No IP, no full user-agent.**

## A3. Feature inventory (built)
- **Compose**: URL lookup → re-pricing chips → live preview → create → Copy-for-Outlook + hosted link.
- **Audience selector**: PCH / BCH / Salary sacrifice, driving compliance block, terms and (salsac) pricing shape.
- **Offer-button CTA**: one primary green button per campaign — *View offer · Call · WhatsApp · Email · Book a
  time to discuss* — each gated on the sender field it needs, with a rep-renamable label (≤30 chars).
- **Secondary contact links**: an optional rep-chosen row (*Call · WhatsApp · Email · Book a call*) under the
  signature, separate from the primary button, pruned to methods whose field is present.
- **Rep profile (persisted)**: portrait photo (upload/replace/remove) and editable contact details
  (name/title/phone/WhatsApp/booking/secondary), remembered per rep and prefilled next time.
- **Brochures**: attach a manufacturer brochure PDF per vehicle — allowlist harvest via Firecrawl, or a manual
  pasted link / uploaded PDF. (Discovery is being redesigned — see `brochure-finder-brief.md`.)
- **Offer library**: save/reuse offers; **Campaigns**: list + per-campaign stats; **Promotions register**:
  master table + CSV export (the FCA compliance record).

## A4. Security & compliance posture
### The four rules that never bend (see `CLAUDE.md`)
1. **Three layers, no leaks.** `packages/schema` is the model; source adapters produce `Offer`s, output
   adapters deliver a `Rendered` campaign; `render()` is the **only** place email/hosted HTML is produced;
   React never builds HTML; no adapter imports another.
2. **CAP IDs are never stored** — not in D1, R2 keys, filenames, logs or HTML. Images/brochures/headshots are
   content-addressed by the **sha256 of our own bytes**; only our R2 URL is kept. `assertNoCapId()` guards
   every persisted object; CI greps for leaks. No raw scraped HTML is ever persisted (the 24 h cache holds
   parsed results only).
3. **Compliance is locked.** Each template carries one Emma-approved compliance block per contract type; reps
   cannot edit it; a campaign cannot render against a template whose status is not `approved`. Rep-authored
   copy is recorded verbatim in the promotions register.
4. **Drafts only.** The Worker never sends email.

### PII posture (decided 16 Sept 2026)
- **Staff (rep) data is business contact data** — name, work email, work phone/WhatsApp, booking link and
  signature photo — processed for the rep's own email signature. Legitimate, minimal, expected; a signature
  headshot is **not** special-category/biometric. Covered by the normal staff-data basis. **No minimisation,
  retention or encryption applied to it.**
- **Customer (recipient) PII is minimised, not stored.** The recipient object (first/last name, email,
  company, etc.) is **personalisation for the render only**: it builds the rep's email greeting and is then
  **stripped at the persist boundary** — it never reaches D1. The recipient's first name renders in the
  **email only**, never on the public hosted page.
- **Engagement logging is PII-free by design** — the click/view log holds a coarse device class + timestamp,
  **no IP, no full user-agent**.
- **Residual, by design:** rep-authored free text (campaign name, subject, intro) is retained as the FCA
  promotion record and *could* contain a name if a rep types one — a training/guidance matter, not a schema
  one. The **suppression list** (planned) will hold recipient emails **hashed**, not in clear.
- **Retention (planned, item 3):** a scheduled purge — recipient-bearing artefacts ≈ **30 days**, the
  (PII-free) promotion record ≈ **6 years** for FCA record-keeping. Both configurable; Emma/DPO set the
  numbers.
- **Platform security:** Cloudflare encrypts D1 and R2 **at rest** by default; everything is **TLS in
  transit**; the tool is behind Access/Entra; data resides in the **EU (WEUR)**. Application-level field
  encryption is available as defence-in-depth for any residual must-keep PII, but is **not** the primary
  control — minimisation is.

---

# Part B — System Architecture

## B1. High-level shape
```
                         ┌─────────────────────────── Cloudflare Worker "offer-mailer" (Hono) ───────────────────────────┐
  Rep browser            │                                                                                               │
  (mailer.dreamlease) ──►│  /api/*   (behind Cloudflare Access → Entra SSO)                                              │
                         │    profile · lookup · brochures · campaigns · library · register · dev-preview                │
                         │                                                                                               │
  Customer browser       │  PUBLIC (no login):  /health · /c/:slug (hosted) · /f/* (files) · /b/:id · /r/:slug/:link     │
  (offers.dreamlease) ──►│                      · /a/* (static assets)                                                   │
                         └───────┬───────────────┬──────────────────┬──────────────────┬───────────────────────────────┘
                                 │               │                  │                  │
                              D1 (SQL)       R2 (objects)     Images (TRANSFORM)   Firecrawl (metered, external)
                          offer-mailer   images/hosted/brochures  resize→R2      scrape/search/map/fetchFile
```
Two hosting surfaces on one Worker:
- **`mailer.dreamlease.co.uk`** — the tool UI + `/api`, **staff-only behind Cloudflare Access**.
- **`offers.dreamlease.co.uk`** — hosted pages, redirects, images, brochures, assets — **public** (customers
  reach them without a login; hosted pages are `noindex` and expire).

Until IT attaches the custom domains + Access, both run on `offer-mailer.matt-wilson-9b8.workers.dev` and
`/api/*` returns **503** (fails closed).

## B2. Monorepo layout (pnpm workspaces)
| Package | Responsibility |
|---|---|
| `packages/schema` | The Zod offer model (brief §5.1) and the `assertNoCapId` guard. The shared contract. |
| `packages/adapters` | Source & output adapters, pure (I/O injected): URL lookup (normalise → HTMLRewriter page parse → site pricing JSON → `buildOffer`), the Firecrawl client, and brochure allowlist/harvest/manual/ensure. No adapter imports another. |
| `packages/render` | `render(campaign, template)` — the sole HTML producer. Card markup translated line-for-line from the v5 reference; four layouts; `.eml` helpers; `diff-reference.ts` fidelity check. |
| `packages/design-system` | Vendored DreamLease design system (`dl-*` React components, tokens, Sofia Pro, `dreamlease.css`), consumed as source. |
| `apps/api` | The Cloudflare Worker (Hono): API, hosted pages, redirects, file serving, static assets. |
| `apps/web` | Vite + React + TS tool UI (Compose / Campaigns / Library / Register). Dev-only today; served from the Worker in prod later. |

## B3. Runtime & bindings (Cloudflare, account `9b8d051…`, Paid plan)
- **Worker** `offer-mailer` (`apps/api/wrangler.jsonc`), `nodejs_compat`, observability on; static assets from
  `./public` via the `ASSETS` binding (`/a/*`).
- **D1** `offer-mailer` (`32d1b987-b550-4bb4-9bfc-dd219c9404d4`, **WEUR**), binding `DB`, Drizzle ORM,
  migrations in `apps/api/migrations`.
- **R2** buckets (**WEUR**): `offer-mailer-images` (`IMAGES`), `offer-mailer-hosted` (`HOSTED`),
  `offer-mailer-brochures` (`BROCHURES`).
- **Images** binding `TRANSFORM` — resizes before storage (vehicle → 1200px JPEG; headshot → 256px square).
- **Access** — `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` gate prod; empty locally.
- **Secrets** — `FIRECRAWL_API_KEY` (`wrangler secret put`); locally `.dev.vars` (git-ignored, also carries
  `DEV_USER_EMAIL`).

## B4. Data model & storage
### D1 tables (`apps/api/src/db/schema.ts`) — JSON snapshots validated by `@offer-mailer/schema`, with queried columns pulled out
| Table | Holds | PII |
|---|---|---|
| `campaigns` | Campaign snapshot (`data`) + slug, template id/version, `createdBy`, timestamps, `links` (linkId→destination for `/r`) | rep email (`createdBy`) + sender block; **no recipient** (stripped at save) |
| `offers` | Saved offer library (`data`) + vehicleKey, validUntil, createdBy | rep email |
| `templates` | Email templates (compliance blocks, footer, markup version) + status/approvedBy/approvedAt | approver email |
| `brochures` | Brochure **metadata** (kind, status, vehicleKey, fetched/expires) — PDF bytes live in R2 | none |
| `senders` | Rep profile: Sender JSON (name/phone/WhatsApp/booking/secondary + headshot URL), keyed by email | rep business data |
| `clicks` | Click/view log: campaignId, linkId, kind, coarse uaClass, timestamp | **none — no IP, no UA** |
| `suppressions` | Opt-out emails + addedBy/at/note (planned; emails to be **hashed**) | recipient email (hashed) |
| `lookup_cache` | 24 h cache of parsed lookup results (Offer + config options) — **never raw HTML** | none |

### R2 objects
| Bucket | Holds | Key | Served |
|---|---|---|---|
| `offer-mailer-images` | vehicle images + rep headshots | `vehicles/<sha256>.jpg`, `headshots/<sha256>.jpg` | `/f/vehicles/*`, `/f/headshots/*` (public) |
| `offer-mailer-hosted` | rendered hosted offer pages | keyed by slug | `/c/<slug>` (public, noindex, expiring) |
| `offer-mailer-brochures` | brochure PDFs | `brochures/<sha256>.pdf` | `/f/brochures/*`, `/b/<id>` (public) |

### Limits & residency
- **D1:** 10 GB **per database** (Paid); live usage **~120 KB**. All small JSON records — never a concern.
  (The Free-tier daily row read/write cap is the one that bites; the **Workers Paid plan** removes it.)
- **R2:** no total cap, billed per GB-month (first 10 GB/mo free); per-object 5 GiB single upload / 5 TiB
  multipart. Our objects are KB–few MB. Never a concern.
- **Residency:** D1 + R2 in **WEUR (EU)**. Cloudflare is the processor (standard DPA applies).

## B5. Routing surface (`apps/api/src/index.ts`)
**Public (no login):** `/health` · `/c/:slug` · `/f/*` · `/b/:id` · `/r/:slug/:link` · `/a/*`.
**Behind Access (`/api/*`, `requireAccess()`):** `/me`, `/me/photo`, `/me/sender` · `/offers/lookup`,
`/offers/library` · `/brochures/ensure`, `/brochures/manual` · `/campaigns`, `/campaigns/preview`,
`/campaigns/:id`, `/campaigns/:id/stats`, `/register`, `/register.csv` · `/dev/*`.

## B6. Authentication & authorization
- **Authentication** — Cloudflare Access with **Microsoft Entra ID** as IdP sits in front of the tool. Access
  stamps each request with a `Cf-Access-Jwt-Assertion`; `requireAccess()` (`middleware/access.ts`) verifies it
  against the team JWKS + the app's `ACCESS_AUD`, and the verified **email** becomes the user identity
  (`{ email, sub }`), used as `createdBy` everywhere. No passwords or accounts are stored by the tool.
  **Local dev:** with `ACCESS_AUD` empty, `DEV_USER_EMAIL` from `.dev.vars` is accepted; with it set, the
  bypass is inert so a misconfigured prod **fails closed (503)**.
- **Authorization (roles)** — two roles (approver parked):
  - **Salesperson** — the default; uses the tool.
  - **Master admin** — template admin; **also self-approves** templates (rule 3's approved-gate stays; the
    master admin flips `draft → approved`).
  Mapping identity → role via a **config allowlist of admin emails** (deploy-time config, not a data store),
  enforced server-side and used by the web app to branch views. Works off whatever verified email Access
  supplies, so it needs no Entra work to build/test and requires no rework when Entra lands. (A later move to
  Entra groups is an easy swap.)

## B7. Rendering & the email template
`render()` is pure and the only HTML producer. Card markup is translated line-for-line from
`design/dreamlease-offer-mailer-v5.html`; after any change to `cards.ts`/`render.ts`, run
`scripts/diff-reference.ts` — any non-data structural difference is a deviation and must be justified in the
`cards.ts` header. Auto layout: 1 → single, 2 → grid2, 3 → stack, 4+ → grid2; grid3 only when chosen.
`MARKUP_VERSION` is bumped when the markup changes in a way Emma should re-approve; templates pin the version
they were approved against. Email geometry follows the v5 non-negotiables (`[if mso]` ghost tables, td-padding
buttons, explicit image sizes, forced light mode).

## B8. External dependencies
- **Firecrawl** — the only metered/external service. Used for brochure discovery/fetch (search/scrape/map, and
  `fetchFile` via `rawBase64` to get PDFs past bot protection). It sees the URLs we scrape (dreamlease pages,
  brochure links) transiently; brochure PDFs it fetches land in **our** R2. **No customer PII passes to it.**
  Cap ≈15 credits per harvest; direct fetch first, Firecrawl fallback, cache 24 h.
- **Microsoft Entra / 365** — identity only (auth). Graph "create draft" is parked; if built, drafts live in
  the rep's own mailbox.
- **Parked / deferred:** Tawk.to webchat (renewals-only stage one — see `status-2026-09-15.md` §7); Graph draft
  (IT Entra app); Google Sheets promotions-register auto-append (the in-app register stands in).

## B9. Build status & roadmap (brief §8.2)
| Step | State |
|---|---|
| 1 Scaffold, schema, D1, Worker, Access, deploy | Done, deployed |
| 2 `render()`, four layouts, hosted page | Done |
| 3 URL lookup, image pipeline, brochure harvest | Done (brochure discovery being redesigned) |
| 4 Web app (Compose/Campaigns/Library/Register) | Core built (dev-only) |
| 5 Graph draft, Copy-for-Outlook | Copy-for-Outlook done; Graph parked |
| 6 Redirects, click logging, stats | Done |
| 7 Template admin, approval, register, suppression | Register done; **template admin (next), suppression pending** |
| 8 Stubs & `evolution.md` | Not started |

**Next:** template admin (chunk 1 = role gate). **PII items outstanding:** retention purge (item 3),
suppression email hashing (item 4, rides with the suppression list). **Owed by others:** IT — Access + custom
domains + Graph Entra app; Emma — approved compliance wording + retention periods; Matt — Firecrawl secret +
Workers Paid plan.

## B10. Testing & verification
- `pnpm test` (vitest across packages) — 141 tests: schema 18, render 27, adapters 52, api 44. `apps/api` tests
  run inside workerd with **real local D1/R2/Images**; adapter tests use the wasm HTMLRewriter.
- `pnpm typecheck` clean (incl. `apps/web`). `scripts/diff-reference.ts` guards email-markup fidelity.
- CI greps for CAP-ID leaks. `.dev.vars` (secrets) is git-ignored and must never be committed.

## B11. Key files index
- Model & guard: `packages/schema/src/model.ts`, `capid.ts`
- Rendering: `packages/render/src/render.ts`, `cards.ts`, `viewmodel.ts`, `layout.ts`, `links.ts`
- Adapters: `packages/adapters/src/url/{normalise,parse-page,pricing,build-offer}.ts`, `firecrawl/`, `brochure/`
- Worker: `apps/api/src/index.ts` (routes), `campaigns.ts`, `profile.ts`, `files.ts`, `brochures.ts`,
  `lookup.ts`, `library.ts`, `hosted.ts`, `tracking.ts`, `middleware/access.ts`, `db/schema.ts`
- Web: `apps/web/src/Compose.tsx`, `api.ts`
- Config: `apps/api/wrangler.jsonc`, `config/` (badges, manufacturer domains, admin allowlist)
