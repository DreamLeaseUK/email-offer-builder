# Pickup prompt — DreamLease Offer Mailer

Paste everything below the line into a new Claude Code session opened in `C:\Users\MatthewWilson\email-offer-builder`. Written 14 September 2026, evening, from the repo and the live Worker; each fact below is marked **verified** (checked against the repo or the live system when written) or **asserted** (recorded from the conversation, not re-checkable from the repo).

---

You are resuming work on the DreamLease Offer Mailer, an internal tool where a sales rep pastes a dreamlease.co.uk offer URL, assembles a branded HTML email of one to six lease offers, and gets an Outlook draft plus a hosted web page.

## How to behave in this project (asserted; agreed with Matt on 14 Sept, recorded in status doc §8)

- Do **not** start a build step, a review, a diagnostic or any other new piece of work without an explicit instruction from Matt. "Continue" is not one.
- Before doing a step, say in plain words what it is, what it changes and what it costs, then wait for his word.
- No background review workflows or multi-agent runs unless he asks. Keep token use down.
- Report outcomes plainly, and state the live Worker's condition after any deploy.
- Matt is Head of Marketing and the only stakeholder you talk to. He tests emails by opening `.eml` fixtures in classic Outlook and New Outlook on Windows and forwarding from New Outlook to his phone (Outlook iOS and Gmail iOS). He sends screenshots. He is direct and wants an agile, frictionless build.

## Read these first, in this order (verified paths)

1. `CLAUDE.md` — the four rules that never bend, the working method for the template, the working agreement, runtime constraints, Cloudflare details, build order.
2. `docs/status-2026-09-14.md` — where the build is (§1), every decision (§2), what is verified (§3), open issues (§4), how to work on the template (§5), what exists (§6), what others owe (§7), the day's sequence and the working agreement (§8).
3. `docs/offer-mailer-implementation-notes.md` — Matt's notes for the v5 markup reference: the non-negotiables and the acceptance test.
4. `docs/dreamlease-offer-mailer-brief.md` — the solution design (v1.1). §5 is the shared contract, §8 the build plan.

## State of the repo and the live system

| Component | Source of truth | Current value | Status |
|---|---|---|---|
| Git | `git log` | HEAD `ca4bb8f` on `main`, tree clean; history `7bc5777` step 1 → `f2b6372` step 2 → `5f798d6`/`51a4925` old diagnostic → `fa14c03` step 3 → `d02e818` revert of step 3 → `5b6d265` v5 markup → `ca4bb8f` step 3 restored | verified |
| Tests / typecheck | `pnpm test`, `pnpm typecheck` | 112 tests (schema 18, adapters 48, render 23, api 23), all passing; typecheck clean at `ca4bb8f` | verified |
| Live Worker | https://offer-mailer.matt-wilson-9b8.workers.dev/health | `{"ok":true,"version":"0.3.0","db":"ok","images":true,"firecrawl":false}` at 19:35 UTC on 14 Sept; deployed from `ca4bb8f` | verified |
| Email markup | `design/dreamlease-offer-mailer-v5.html` (send-ready reference, all four layouts) | `packages/render` reproduces it; `scripts/diff-reference.ts` shows every section structurally identical apart from the 98px logo (asset is 196px wide) and fixture badge counts; `MARKUP_VERSION` = 2, fixture template pins 2 | verified |
| Visual preview | `design/offer-mailer-email-template-v2.dc.html` | reference for look only; the HTML file wins where they disagree | verified (file present; rule is from the notes) |
| Client acceptance of the v5 build | Matt's Outlook/phone pass (implementation notes, "Acceptance test") | six fixture `.eml` files were sent to Matt on 14 Sept from `packages/render/out/` (regenerate with `pnpm --filter @offer-mailer/render fixtures`); **no results yet** | asserted |
| Step 3 lookup | `packages/adapters/src/url/*`, `apps/api/src/lookup.ts` | `POST /api/offers/lookup {url}` → `{offer, options, message, cached, warnings}`; page parsed with HTMLRewriter for identity/stats/image URL, price from the site's `GET /api/carresults/GetOfferDropdownsForCar` JSON, initial payment = months × monthly, D1 `lookup_cache` for 24 h holding the parsed result only | verified (tests, and a live `wrangler dev` lookup of a real BYD Seal page on 14 Sept returned 347.80/month, 4173.60 initial, 12/48/6000, cache hit in 26 ms) |
| Step 3 images | `apps/api/src/files.ts`, Images binding `TRANSFORM`, R2 `IMAGES` | source image fetched, transformed to JPEG q82 on white, stored `vehicles/<sha256>.jpg`, served at `/f/vehicles/<sha>.jpg`; site images are 750px wide so stored copies are 750×500 | verified |
| Step 3 brochures | `packages/adapters/src/brochure/*`, `apps/api/src/brochures.ts` | `POST /api/brochures/ensure`, `POST /api/brochures/manual`, `GET /api/brochures/current`, public `GET /b/<id>`, `GET /f/brochures/<sha>.pdf`; harvest via Firecrawl with a 15-credit cap, UK allowlist `config/manufacturer-uk-domains.json`, 90-day expiry, superseded copies keep serving | verified in tests with real local D1/R2; harvest never run against real Firecrawl (no key) |
| Access | `apps/api/wrangler.jsonc` vars `ACCESS_AUD` = "" | every `/api` route answers 503 in production until Cloudflare Access is configured (IT); locally `wrangler dev` uses `DEV_USER_EMAIL` from `apps/api/.dev.vars` | verified |
| Firecrawl | Worker secret `FIRECRAWL_API_KEY` | not set (health shows `firecrawl:false`); URL lookup does not need it, brochure harvest answers 503 without it | verified |
| Assets | `apps/api/public/a/` | `logo-2x.png`, `vehicle-placeholder.png`, and placeholder glyphs drawn in code: `icon-doc-2x.png`, `icon-external-2x.png` (28px), `headshot-placeholder.png` (112px). Replace the placeholders with design-system artwork when Matt supplies it | verified |
| Config Matt maintains | `config/badges.json`, `config/manufacturer-uk-domains.json` | fixed badge list; brochure host allowlist | verified |
| Deploy | `pnpm run deploy` (bare `pnpm deploy` is pnpm's own command) | wrangler auth expires; on an auth error ask Matt to run the login command in status doc §6 from his own terminal | verified (command); asserted (auth expiry) |

## Load-bearing constraints (all verified in code or tests)

- **CAP IDs are never stored.** They appear in the site's image URLs and as a bare number in the pricing JSON's `rateBookIdentifier`. The parser copies named fields only; `assertNoCapId()` guards every persisted object; test fixtures are real pages with the image host replaced and the CAP ID zeroed. Never persist raw scraped HTML.
- **The v5 markup's non-negotiables** are in the code and asserted by tests: `[if mso]` ghost tables with one ghost `<td>` per card in rows (and inside the stack card and hero CTA row); buttons as td padding + `display:block` anchor + `mso-padding-alt:0`, no VML; fixed image sizes; background/padding/radius on cells; no negative margins; fixed-width pills (126 hero, 100 stack/grid2); forced light mode with `lock-*` classes; the media query as enhancement only. After any change to `cards.ts` or `render.ts`, run `pnpm --filter @offer-mailer/render exec tsx scripts/diff-reference.ts` and justify any non-data difference in the header of `cards.ts`.
- **Compliance is locked** (template record, Emma approves); **drafts only** (the Worker never sends); **three layers, no leaks** (`render()` is the only place HTML is produced; adapters do not import each other).
- Auto layout: 1 → single, 2 → grid2, 3 → stack, 4+ → grid2; grid3 only when chosen.

## Open questions only Matt can settle (asserted)

1. Does the v5 build pass his Outlook, New Outlook and phone checks? Three things the earlier review saw and the v5 constructions bring back need confirming or refuting: classic Outlook unwrapping ghost tables on forward, Word not floating the `align="left"` badge tables, Word with `mso-padding-alt:0` buttons. If any reproduces, it is a change to the reference and the code together, via a labelled diagnostic, not a patch.
2. Width is 600px per the reference; he had asked for 640 after the first review.
3. Whether step 3 stays as it is (it is live but unreachable until Access exists) or waits.
4. The Firecrawl secret and the Workers Paid plan (status doc §7).

## Next build step, when Matt asks for it

Step 4 (brief §8.2): the web app on Vite + React using the DreamLease design-system components (the `dreamlease-design-system` repo is not in this workspace; `C:\Users\MatthewWilson\Downloads\dreamlease-design-system.zip` exists, unverified beyond its presence): campaigns list, compose, the add-offer modal on `POST /api/offers/lookup` with chips from the response's `options`, offer library, live preview. Before starting, tell Matt what it involves and wait.

## Start

Confirm in a few lines that you have read the four documents, state the git and live state as you find them, and ask whether Matt's acceptance results for the v5 emails are in. Propose nothing else until he answers.
