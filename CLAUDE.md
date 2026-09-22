# DreamLease Offer Mailer

Internal tool: a rep pastes a dreamlease.co.uk offer URL, assembles a branded HTML email of one to six lease offers, and gets Outlook-ready HTML (Copy for Outlook, pasted into a New Outlook message; the Graph draft is designed but parked on IT) plus a hosted web page. The full brief is `docs/dreamlease-offer-mailer-brief.md` (v1.1). The email markup source of truth is `design/dreamlease-offer-mailer-v5.html` with its implementation notes in `docs/offer-mailer-implementation-notes.md`; the visual preview is `design/offer-mailer-email-template-v2.dc.html` (where they disagree, the HTML file wins). Read the brief before changing anything that touches the data model, rendering, delivery or compliance.

**The authoritative technical map is `docs/architecture.md` (Solution Design & System Architecture, current-state).** Current state, decisions and open issues live in `docs/status-2026-09-21.md` (`-09-18.md` / `-09-16.md` / `-09-15.md` / `-09-14.md` are kept for history). **Resuming a session: `docs/PICKUP-PROMPT.md`** (rewritten end of session 5, 21 Sept — the definitive hand-off; its state claims are marked verified or asserted). **Brochure discovery is the finder (built 18 Sept 2026, no allowlist): the design, the decisions and the evidence are in `docs/brochure-finder-brief.md`. Since 21 Sept it has two tiers: the UK edition first, then the manufacturer's European brochure if it is in English (`market: 'eu'`, titled "European edition"), which is only ever OFFERED to the rep, never attached by itself — rules and evidence in `docs/status-2026-09-21.md` §3–§4, §9 (finder-1.4) and §10 (the offer).**

## Working method for the email template

`packages/render` reproduces the v5 markup file line for line as TypeScript template functions. After any change to `cards.ts` or `render.ts`, run `pnpm --filter @offer-mailer/render exec tsx scripts/diff-reference.ts`: it diffs the rendered tag structure of every section against the reference, and any difference that is not data (text, href, src, alt) is a deviation that must be justified in the header of `cards.ts`. The expected result is NOT zero: today it reports 86 lines (2 the logo width, 6 the third hero pill, 14 the inline-block pills and the stack image column, 64 the name-before-picture reorder of 22 Sept: 50 the stacked card, 14 the hero), all recorded there; more than that is a regression. **Current scope (Matt, 21 Sept 2026): Gmail (web + app) and New Outlook (desktop + mobile), sent the real way: Copy for Outlook, paste into a New Outlook message, send.** That paste drops the `<style>` block and the conditional comments; with Outlook's default "Merge formatting" for other apps it also flattens text colour and size (cause found 22 Sept, `docs/status-2026-09-21.md` §11: the rep must paste with Keep source formatting), so a fix is judged on what ARRIVES, from a real send made with `pnpm dev:live`, never on the preview alone (`docs/architecture.md` A5). For anything outside that scope (classic Outlook, the full matrix) the older method still holds: do not change a construction in response to a single screenshot; build a labelled diagnostic `.eml` (`packages/render/scripts/diag-*.ts`) with the real card in each candidate construction, have Matt check it, collect all results, then change the reference and the code together. Classic Outlook unwraps `[if mso]` markup when it forwards, so a forwarded copy is Word's rendering, not the original.

## Working with Matt

Do not start a build step, a review, a diagnostic or any other new piece of work without an explicit instruction; "continue" is not one. Before doing a step, say in plain words what it is, what it changes and what it costs, then wait. No background review workflows or multi-agent runs unless he asks. Report outcomes plainly, with the live Worker's state after every deploy. (Agreed 14 Sept 2026; the reason is in `docs/status-2026-09-14.md` §8.)

## Four rules that never bend

1. **Three layers, no leaks.** `packages/schema` is the offer model (Zod). Source adapters produce `Offer`s; output adapters deliver a `Rendered` campaign. `render(campaign, template)` in `packages/render` is a pure function and the only place email or hosted HTML is produced. No adapter imports another adapter. React components never build HTML. The markup is TypeScript template functions translated line for line from the v5 markup reference (decided 14 Sept 2026: no MJML, it would only re-derive markup the design already hand-built for email). `MARKUP_VERSION` in `packages/render` is bumped when the markup changes in a way Emma should see; templates pin the version they were approved against.
2. **CAP IDs are never stored.** The website's vehicle image URLs contain a CAP ID (`images.motorleaseplatform.com/cvd/?...capId=...`). Never persist those URLs or any CAP ID in D1, R2 keys, logs, filenames, cache entries or rendered HTML. Images are fetched, transformed and stored under `vehicles/<sha256>.jpg`; only our R2 URL is kept. `assertNoCapId()` in `packages/schema` guards every persisted object, and the test suites assert that stored rows, link maps and rendered HTML carry none (there is no CI pipeline yet: the check is `pnpm test`). Never persist raw scraped HTML at all; the 24-hour lookup cache holds parsed lookup results (the `Offer` plus the site's term/mileage options) only. The site's pricing JSON carries the CAP ID as a bare number inside `rateBookIdentifier`; the parser copies named fields only and never that one.
3. **Compliance is locked.** Each template carries one Emma-approved compliance block per contract type. Reps cannot edit it. A campaign cannot render against a template whose status is not `approved`. Rep-authored copy (intro, subject, preheader, CTA label) is recorded verbatim in the promotions register alongside the archived HTML. Badges come from a fixed list, never free text.
4. **Drafts only.** The Worker never sends email. Delivery is clipboard HTML the rep pastes into Outlook (built), or a Graph draft in the rep's mailbox (designed, not built: needs IT's Entra app). A human always presses Send.

## Runtime constraints

- Everything runs on Cloudflare: Workers (Paid plan) with static assets, D1, R2, Access, Image transformations. No Pages, Netlify, Surge or Supabase.
- Nothing CPU-heavy in the request path: rendering is string templating, images resize via the Cloudflare Images binding (`TRANSFORM`), HTML parses with HTMLRewriter. Offer prices are not in the page HTML: the site's own `GET /api/carresults/GetOfferDropdownsForCar` JSON prices a configuration and lists the term/mileage options; the page supplies identity, stats and the image URL.
- Firecrawl is the only metered service. Direct fetch first, Firecrawl fallback, cache for 24 hours. A brochure search caps at 25 credits (typically 10–12; 22–24 when several documents have to be opened): two searches, one Map, the model's page operated in one 1-credit scrape with page actions (`brochure/operate.ts`), then each PDF read at 4. Prove any change to the finder with a live sweep (`packages/adapters/scripts/finder-sweep.mts`) and read the traces: the first sweep of finder-1.4 found three WRONG attachments the tests had not. A FOUND brochure is reused by every rep for 90 days; a "nothing found" is remembered for 7 days, but never a failed search and never one made under an older `FINDER_VERSION`, so a rules change re-runs (and re-pays for) those searches.
- Design tokens: green CTA `#31BD51`, Ignition Red `#E30613` for prices and links, badge orange `#FF8811`, black headings, Graphite `#787580` body, borders `#E1E0E4`, panels `#F6F6F7`. Email font stack is Arial fallback; Sofia Pro is UI only.
- Email geometry lives in `packages/render/src/layout.ts` and follows the v5 reference: a 600px-max fluid wrapper (the reference fixed it at 600px; see the deviations below) with the media query as enhancement only (the fluid-hybrid `display:inline-block; width:100%; max-width` cards stack without it). Auto layout (Matt, 21 Sept 2026): one offer per row: 1 single, 2+ stack; the two-up / three-up grids still render for a stored campaign but the tool no longer offers them. The real send path is HTML pasted into New Outlook, which drops the `<style>` block and the conditional comments, so nothing may DEPEND on the media query or on `[if mso]`: the wrapper is fluid (100% up to 600px), pills are inline-block not floated, and the stack card's image column is calc()-fluid (deviations a–c in the header of `cards.ts`). The reference's non-negotiables (`docs/offer-mailer-implementation-notes.md`): `[if mso]` ghost tables around every card group with one ghost `<td>` per card in rows of two or three, and inside the stack card and the hero CTA row; buttons as td padding + `display:block` anchor + `mso-padding-alt:0`, no VML, square corners in Outlook classic accepted; images with explicit width and height (hero 550×413, stack 218×164, grid2 262×197, grid3 166×125, headshot 56×56); background, padding and radius on a `<td>`; no negative margins, spacers as `<td height>` cells; fixed-width badge pills (td width 126 hero, 100 stack/grid2); forced light mode via the `color-scheme` metas, the `[data-ogsc]`/`[data-ogsb]` overrides and `lock-*` classes on every coloured cell. History: the 14 Sept client review had removed the body ghost tables and `mso-padding-alt` and used VML pills after single-client observations (classic Outlook unwrapping conditionals on forward, Word collapsing padded cells); Matt's v5 brief that afternoon restored the reference constructions, so those observations are now things to re-verify in the acceptance pass, not rules.

## Layout

```
apps/api           Cloudflare Worker (Hono): API, hosted pages (/c), redirects (/r), stored files (/f), brochure links (/b), email assets (/a), the daily Cron. It does NOT serve the web app yet.
apps/web           Vite + React tool UI: Compose, Campaigns, Library, Register, Suppressions, Templates (admin). Runs locally only (port 5173, proxying to the API on 8787).
packages/schema    Zod schemas from brief §5.1, CAP ID guard, decoding of the site's HTML entities (text.ts)
packages/adapters  Source and output adapter interfaces (§5.2) and implementations: url lookup (normalise, HTMLRewriter page parser, site pricing JSON, offer assembly), Firecrawl client, brochure finder / harvest (which also holds the manual upload-or-paste path) / ensure. Pure: I/O is injected.
packages/render    render(), card markup from the v5 reference with the deviations recorded in cards.ts, row height matching (match.ts, measure.ts), fixtures, .eml helper for client testing
packages/design-system  Vendored DreamLease design system: dl-* React components, tokens, Sofia Pro, styles/dreamlease.css. apps/web imports it (workspace package). Source, not built dist.
docs/              Briefs
design/            Claude Design export of the email template and its assets
```

## Commands

```
pnpm install
pnpm dev                 # wrangler dev for the API (localhost:8787), LOCAL storage: fine for building, useless for a real send
pnpm dev:live            # the same API on PRODUCTION D1/R2/Images (wrangler dev --remote). Use this for any email that
                         # will actually be sent: a campaign made on local storage points its images, hosted page and
                         # tracked links at production, which does not have them (all 404). Writes real production data.
pnpm --filter @offer-mailer/web dev   # Vite dev server for the tool UI; proxies /api etc. to wrangler dev
pnpm test                # vitest across packages
pnpm typecheck
pnpm db:generate         # drizzle-kit generate -> apps/api/migrations
pnpm db:migrate:local    # apply migrations to the local D1
pnpm db:migrate          # apply migrations to the remote D1
pnpm run deploy          # "run" matters: bare `pnpm deploy` is pnpm's own command
```

API tests run inside workerd (`@cloudflare/vitest-pool-workers`, vitest 4 in `apps/api` only) with real local D1, R2 and Images bindings; `.dev.vars` is loaded, so the bare test `env` already has a dev user. The pool's workerd can trail wrangler's; `apps/api/vitest.config.ts` pins the test compatibility date. Adapter tests run under plain vitest with the wasm HTMLRewriter. Fixtures under `packages/adapters/test/fixtures` are real pages with the image host replaced and the CAP ID zeroed; keep them that way.

## Cloudflare

- Account: Matt.wilson@dreamlease.co.uk's Account (`9b8d051edc5cc97c80e3d26c7e09e4cb`). `wrangler login` as Matt.
- Worker `offer-mailer`, first deployed 14 Sept 2026, v0.5.0 since 21 Sept: https://offer-mailer.matt-wilson-9b8.workers.dev. Custom domains come with Access setup (IT): `offers.dreamlease.co.uk` is free, but **`mailer.dreamlease.co.uk` is already taken** by an unrelated host, so the tool needs another name (proposed `offer-mailer.`); DNS is at GoDaddy and the subdomain must be Cloudflare-served. Until then production `/api` answers 503 and the production Firecrawl secret is not set (`/health`: `firecrawl:false`).
- D1 `offer-mailer` (`32d1b987-b550-4bb4-9bfc-dd219c9404d4`, WEUR). Migrations applied with `pnpm db:migrate`.
- R2 buckets `offer-mailer-images`, `offer-mailer-hosted`, `offer-mailer-brochures` (WEUR), bound as `IMAGES`, `HOSTED`, `BROCHURES`.

Local dev auth: copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars`. When `ACCESS_AUD` is empty the Access middleware accepts `DEV_USER_EMAIL` as the signed-in user. **Production today has `ACCESS_AUD` EMPTY too** (Access is not configured yet): `/api` answers 503 there only because `DEV_USER_EMAIL` is not defined in production. **Never set `DEV_USER_EMAIL` as a production var or secret**: with `ACCESS_AUD` empty it would open the whole API, with no login, as that user. Once IT configures Access, `ACCESS_AUD` is set and the bypass is inert.

## Build order (brief §8.2)

1. Schemas, D1 migrations, Worker skeleton with Access middleware, health route, deploy. **Done when a URL answers `/health`.**
2. `render()` with the template (now the v5 reference) and four layouts; hosted page route; prove it in real Outlook, including edit-then-send.
3. URL lookup adapter, parser, image pipeline, config chips, cache; brochure harvest.
4. Web app: campaigns, compose, add-offer, library, preview.
5. Graph draft adapter, Copy for Outlook, sender picker.
6. Redirect Worker, click logging, stats.
7. Template admin, approval, promotions register CSV, suppression list.
8. Stubs and `docs/evolution.md` for feed, monday, ai, mautic.

State (21 Sept 2026): steps 1–7 are done, with two gaps: the Graph draft of step 5 is parked on IT, and the web app of step 4 runs locally only. Step 8 is not started. `docs/architecture.md` B9 has the detail.
