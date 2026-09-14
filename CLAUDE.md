# DreamLease Offer Mailer

Internal tool: a rep pastes a dreamlease.co.uk offer URL, assembles a branded HTML email of one to six lease offers, and gets an Outlook draft plus a hosted web page. The full brief is `docs/dreamlease-offer-mailer-brief.md` (v1.1) and the email template design is `design/offer-mailer-email-template-v4.dc.html` with its own brief in `docs/dreamlease-offer-mailer-email-template-v2-brief.md`. Read the brief before changing anything that touches the data model, rendering, delivery or compliance.

## Four rules that never bend

1. **Three layers, no leaks.** `packages/schema` is the offer model (Zod). Source adapters produce `Offer`s; output adapters deliver a `Rendered` campaign. `render(campaign, template)` in `packages/render` is a pure function and the only place email or hosted HTML is produced. No adapter imports another adapter. React components never build HTML.
2. **CAP IDs are never stored.** The website's vehicle image URLs contain a CAP ID (`images.motorleaseplatform.com/cvd/?...capId=...`). Never persist those URLs or any CAP ID in D1, R2 keys, logs, filenames, cache entries or rendered HTML. Images are fetched, transformed and stored under `vehicles/<sha256>.jpg`; only our R2 URL is kept. `assertNoCapId()` in `packages/schema` guards every persisted object and CI greps for leaks. Never persist raw scraped HTML at all; the 24-hour lookup cache holds parsed `Offer` objects only.
3. **Compliance is locked.** Each template carries one Emma-approved compliance block per contract type. Reps cannot edit it. A campaign cannot render against a template whose status is not `approved`. Rep-authored copy (intro, subject, preheader, CTA label) is recorded verbatim in the promotions register alongside the archived HTML. Badges come from a fixed list, never free text.
4. **Drafts only.** The Worker never sends email. Delivery is a Graph draft in the rep's mailbox, or clipboard HTML. A human always presses Send.

## Runtime constraints

- Everything runs on Cloudflare: Workers (Paid plan) with static assets, D1, R2, Access, Image transformations. No Pages, Netlify, Surge or Supabase.
- Nothing CPU-heavy in the request path: MJML compiles at build time, images resize via Cloudflare Image transformations, HTML parses with HTMLRewriter.
- Firecrawl is the only metered service. Direct fetch first, Firecrawl fallback, cache for 24 hours. Brochure harvests cap at ~15 credits.
- Design tokens: green CTA `#31BD51`, Ignition Red `#E30613` for prices and links, badge orange `#FF8811`, black headings, Graphite `#787580` body, borders `#E1E0E4`, panels `#F6F6F7`. Email font stack is Arial fallback; Sofia Pro is UI only.

## Layout

```
apps/api           Cloudflare Worker (Hono): API, hosted pages, redirects, static assets for the web app
apps/web           Vite + React tool UI (build step 4)
packages/schema    Zod schemas from brief §5.1, CAP ID guard
packages/adapters  Source and output adapter interfaces (§5.2) and implementations
packages/render    MJML source, build-time compile, render()
docs/              Briefs
design/            Claude Design export of the email template and its assets
```

## Commands

```
pnpm install
pnpm dev                 # wrangler dev for the API
pnpm test                # vitest across packages
pnpm typecheck
pnpm db:generate         # drizzle-kit generate -> apps/api/migrations
pnpm db:migrate:local    # apply migrations to the local D1
pnpm db:migrate          # apply migrations to the remote D1
pnpm deploy
```

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
