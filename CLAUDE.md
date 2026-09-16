# DreamLease Offer Mailer

Internal tool: a rep pastes a dreamlease.co.uk offer URL, assembles a branded HTML email of one to six lease offers, and gets an Outlook draft plus a hosted web page. The full brief is `docs/dreamlease-offer-mailer-brief.md` (v1.1). The email markup source of truth is `design/dreamlease-offer-mailer-v5.html` with its implementation notes in `docs/offer-mailer-implementation-notes.md`; the visual preview is `design/offer-mailer-email-template-v2.dc.html` (where they disagree, the HTML file wins). Read the brief before changing anything that touches the data model, rendering, delivery or compliance.

**The authoritative technical map is `docs/architecture.md` (Solution Design & System Architecture, current-state).** Current state, decisions and open issues live in `docs/status-2026-09-16.md` (`-09-15.md` / `-09-14.md` are kept for history). **Resuming a session: `docs/PICKUP-PROMPT.md`** (rewritten end of session 3, 16 Sept — the definitive hand-off). **The deferred major task — replacing brochure discovery — is briefed in `docs/brochure-finder-brief.md`.**

## Working method for the email template

`packages/render` reproduces the v5 markup file line for line as TypeScript template functions. After any change to `cards.ts` or `render.ts`, run `pnpm --filter @offer-mailer/render exec tsx scripts/diff-reference.ts`: it diffs the rendered tag structure of every section against the reference, and any difference that is not data (text, href, src, alt) is a deviation that must be justified in the header of `cards.ts`. Do not change the reference's constructions in response to a single screenshot; if a client shows a fault, build a labelled diagnostic `.eml` (`packages/render/scripts/diag-*.ts`) with the real card in each candidate construction, have Matt check it in classic Outlook, New Outlook desktop (wide and narrow pane) and on his phone via a New Outlook forward, collect all results, then change the reference and the code together. Classic Outlook unwraps `[if mso]` markup when it forwards, so a forwarded copy is Word's rendering, not the original.

## Working with Matt

Do not start a build step, a review, a diagnostic or any other new piece of work without an explicit instruction; "continue" is not one. Before doing a step, say in plain words what it is, what it changes and what it costs, then wait. No background review workflows or multi-agent runs unless he asks. Report outcomes plainly, with the live Worker's state after every deploy. (Agreed 14 Sept 2026; the reason is in `docs/status-2026-09-14.md` §8.)

## Four rules that never bend

1. **Three layers, no leaks.** `packages/schema` is the offer model (Zod). Source adapters produce `Offer`s; output adapters deliver a `Rendered` campaign. `render(campaign, template)` in `packages/render` is a pure function and the only place email or hosted HTML is produced. No adapter imports another adapter. React components never build HTML. The markup is TypeScript template functions translated line for line from the v5 markup reference (decided 14 Sept 2026: no MJML, it would only re-derive markup the design already hand-built for email). `MARKUP_VERSION` in `packages/render` is bumped when the markup changes in a way Emma should see; templates pin the version they were approved against.
2. **CAP IDs are never stored.** The website's vehicle image URLs contain a CAP ID (`images.motorleaseplatform.com/cvd/?...capId=...`). Never persist those URLs or any CAP ID in D1, R2 keys, logs, filenames, cache entries or rendered HTML. Images are fetched, transformed and stored under `vehicles/<sha256>.jpg`; only our R2 URL is kept. `assertNoCapId()` in `packages/schema` guards every persisted object and CI greps for leaks. Never persist raw scraped HTML at all; the 24-hour lookup cache holds parsed lookup results (the `Offer` plus the site's term/mileage options) only. The site's pricing JSON carries the CAP ID as a bare number inside `rateBookIdentifier`; the parser copies named fields only and never that one.
3. **Compliance is locked.** Each template carries one Emma-approved compliance block per contract type. Reps cannot edit it. A campaign cannot render against a template whose status is not `approved`. Rep-authored copy (intro, subject, preheader, CTA label) is recorded verbatim in the promotions register alongside the archived HTML. Badges come from a fixed list, never free text.
4. **Drafts only.** The Worker never sends email. Delivery is a Graph draft in the rep's mailbox, or clipboard HTML. A human always presses Send.

## Runtime constraints

- Everything runs on Cloudflare: Workers (Paid plan) with static assets, D1, R2, Access, Image transformations. No Pages, Netlify, Surge or Supabase.
- Nothing CPU-heavy in the request path: rendering is string templating, images resize via the Cloudflare Images binding (`TRANSFORM`), HTML parses with HTMLRewriter. Offer prices are not in the page HTML: the site's own `GET /api/carresults/GetOfferDropdownsForCar` JSON prices a configuration and lists the term/mileage options; the page supplies identity, stats and the image URL.
- Firecrawl is the only metered service. Direct fetch first, Firecrawl fallback, cache for 24 hours. Brochure harvests cap at ~15 credits.
- Design tokens: green CTA `#31BD51`, Ignition Red `#E30613` for prices and links, badge orange `#FF8811`, black headings, Graphite `#787580` body, borders `#E1E0E4`, panels `#F6F6F7`. Email font stack is Arial fallback; Sofia Pro is UI only.
- Email geometry lives in `packages/render/src/layout.ts` and follows the v5 reference: a fixed 600px wrapper that the media query makes fluid on phones (enhancement only; the fluid-hybrid `display:inline-block; width:100%; max-width` cards stack without it). Auto layout: 1 single, 2 grid2, 3 stack, 4+ grid2; grid3 only when chosen. The reference's non-negotiables (`docs/offer-mailer-implementation-notes.md`): `[if mso]` ghost tables around every card group with one ghost `<td>` per card in rows of two or three, and inside the stack card and the hero CTA row; buttons as td padding + `display:block` anchor + `mso-padding-alt:0`, no VML, square corners in Outlook classic accepted; images with explicit width and height (hero 550×413, stack 218×164, grid2 262×197, grid3 166×125, headshot 56×56); background, padding and radius on a `<td>`; no negative margins, spacers as `<td height>` cells; fixed-width badge pills (td width 126 hero, 100 stack/grid2); forced light mode via the `color-scheme` metas, the `[data-ogsc]`/`[data-ogsb]` overrides and `lock-*` classes on every coloured cell. History: the 14 Sept client review had removed the body ghost tables and `mso-padding-alt` and used VML pills after single-client observations (classic Outlook unwrapping conditionals on forward, Word collapsing padded cells); Matt's v5 brief that afternoon restored the reference constructions, so those observations are now things to re-verify in the acceptance pass, not rules.

## Layout

```
apps/api           Cloudflare Worker (Hono): API, hosted pages, redirects, static assets for the web app
apps/web           Vite + React tool UI (build step 4, in progress): compose screen wired to the API
packages/schema    Zod schemas from brief §5.1, CAP ID guard
packages/adapters  Source and output adapter interfaces (§5.2) and implementations: url lookup (normalise, HTMLRewriter page parser, site pricing JSON, offer assembly), Firecrawl client, brochure allowlist/harvest/manual/ensure. Pure: I/O is injected.
packages/render    render(), card markup from the v4 design, fixtures, .eml helper for client testing
packages/design-system  Vendored DreamLease design system: dl-* React components, tokens, Sofia Pro, styles/dreamlease.css. apps/web imports it (workspace package). Source, not built dist.
docs/              Briefs
design/            Claude Design export of the email template and its assets
```

## Commands

```
pnpm install
pnpm dev                 # wrangler dev for the API (localhost:8787)
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
- Worker `offer-mailer`, first deployed 14 Sept 2026: https://offer-mailer.matt-wilson-9b8.workers.dev (custom domains `mailer.` and `offers.dreamlease.co.uk` come with Access setup).
- D1 `offer-mailer` (`32d1b987-b550-4bb4-9bfc-dd219c9404d4`, WEUR). Migrations applied with `pnpm db:migrate`.
- R2 buckets `offer-mailer-images`, `offer-mailer-hosted`, `offer-mailer-brochures` (WEUR), bound as `IMAGES`, `HOSTED`, `BROCHURES`.

Local dev auth: copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars`. When `ACCESS_AUD` is empty the Access middleware accepts `DEV_USER_EMAIL` as the signed-in user. In production `ACCESS_AUD` is set and the bypass is inert.

## Build order (brief §8.2)

1. Schemas, D1 migrations, Worker skeleton with Access middleware, health route, deploy. **Done when a URL answers `/health`.**
2. `render()` with the v4 template and four layouts; hosted page route; prove it in real Outlook, including edit-then-send.
3. URL lookup adapter, parser, image pipeline, config chips, cache; brochure harvest.
4. Web app: campaigns, compose, add-offer, library, preview.
5. Graph draft adapter, Copy for Outlook, sender picker.
6. Redirect Worker, click logging, stats.
7. Template admin, approval, promotions register CSV, suppression list.
8. Stubs and `docs/evolution.md` for feed, monday, ai, mautic.
