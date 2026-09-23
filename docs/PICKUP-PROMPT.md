# Pickup prompt — DreamLease Offer Mailer

Paste everything below the line into a new Claude Code session opened in `C:\Users\MatthewWilson\email-offer-builder`.
**Updated 23 September 2026 (end of session 7).** It supersedes all earlier pickup prompts. Every state claim is
marked **[verified 23 Sept]** (checked against the repo or the live system that day) or **[asserted]** (recorded,
not re-checked). Verify before you act: run the pickup-verify skill if it is available.

---

You are resuming the **DreamLease Offer Mailer**: an internal tool where a salesperson pastes a dreamlease.co.uk
vehicle URL, assembles a branded HTML email of one to six lease offers, and gets Outlook-ready HTML plus a hosted
web page. It is an FCA-regulated financial-promotions tool (compliance matters).

## 0. How to behave with Matt (read this first)

- Matt is Head of Marketing and the only stakeholder. He is **blunt, direct, and has zero patience for waffle,
  hedging, or process-for-its-own-sake.** Give him substance, evidence and decisions — not essays.
- **Do not start a build step, review, diagnostic, or any new work without an explicit instruction.** "Continue" is
  not one. Before a step, say in one or two lines what it is / changes / costs, then act.
- Do **not** hide behind "compliance sign-off needed" as a reason not to build. Where a human check genuinely
  matters, build it *into* the flow, don't make it a gate.
- He works **agile, by real test sends**: he makes a campaign, pastes it into New Outlook, sends it to Gmail and
  Outlook, and sends you screenshots. Diagnose from evidence (the trace, the stored campaign, the as-received HTML),
  fix, and let him re-test. Do not answer a rendering problem with a process proposal.
- When you claim something works, **prove it** (a live call, a test run, a measurement in a real browser).
- When he reports a fault, **read the evidence before theorising**: the stored brochure trace, the stored campaign,
  the page itself. On 21 Sept every finder miss he reported was a specific defect visible in the trace.
- He sometimes pastes an analysis from elsewhere as the direction to take (he did for finder-1.4). Take it as the
  brief, say where it has to be adapted to this system (there: Playwright cannot run in the Worker, Firecrawl's page
  actions can), and build it.
- **No multi-agent / workflow runs unless he asks** (`CLAUDE.md`) — even when a session is set to prefer them, this
  standing rule wins; do the work solo unless he says otherwise. A read-only doc audit was run once (21 Sept) because
  he asked for every design document to be updated; it is not the default.
- Commit only when asked; he has been committing directly to `main` this project. Report the live system's state
  plainly after any deploy.

## 1. Read these, in order

1. `CLAUDE.md` — the four rules that never bend, the current rendering scope, the working agreement, commands.
2. **This file.**
3. **`docs/architecture.md`** — the authoritative Solution Design & System Architecture. The parts that changed most
   recently: **A3 / B7c (the offer library rebuilt as a curated repository, and Copy a past campaign, both priced
   live on use)**, **A5 (the real send path)** and **B7 / B7b (rendering deviations, and the brochure finder)**.
4. **`docs/status-2026-09-23.md`** — the current build log: §1–§4 the offer-library rebuild (`architecture.md` B7c),
   §4a the identifiable campaigns list + Copy a past campaign with live re-pricing, §0 the 22 Sept render/paste work.
   Then `docs/status-2026-09-21.md` — the finder day in parts (§3–§6 the European fallback, §7 the real sends and one
   offer per row, §8 the first misses, §9 finder-1.4 + the 17-car sweep, §10 the European edition becoming an OFFER,
   §11 the paste fix). Older status files are history.
5. `docs/brochure-finder-brief.md` — the brochure finder's design and evidence (read its status banner first).
6. `docs/dreamlease-offer-mailer-brief.md` — the product brief (v1.1); §5 is the shared contract, **§9a is the
   as-built log** (where the build has left the brief).
7. `docs/offer-mailer-implementation-notes.md` — the v5 markup reference; **read its 21 Sept status block first**,
   several of its non-negotiables no longer hold as written.
8. `docs/it-runbook-sign-in.md` — the one-page IT runbook (Cloudflare Access + Microsoft Entra ID), with a
   data-protection section. Hand this to IT to unblock production.

## 2. Repo & live state

- **Git [verified 23 Sept]:** branch `main`, pushed to `origin` = `https://github.com/DreamLeaseUK/email-offer-builder`
  (private). Working tree clean. **HEAD is `e552fca`** ("web: copy re-prices every offer live from its source URL").
  Recent: `7eaf108` (copy a past campaign + identifiable list), `d8ff398` (rep → salesperson sweep), `7bbf13d`
  (offer-library rebuild). The `brochure-finder` branch is fully merged and can be deleted. `git log --oneline -20`
  for the rest.
- **Tests [verified 23 Sept]:** `pnpm test` → **217 pass** (schema 23, render 34, adapters 92, api 68 incl. 9 library);
  `pnpm typecheck` clean (incl. `apps/web`); `apps/web` builds. No CI: the tests are the only gate. `diff-reference`
  reports **82** differing lines (2 logo width, 6 the third hero pill, 6 inline-block pills, 4 the stack image column,
  64 the name-before-picture reorder of 22 Sept), all recorded in the header of `packages/render/src/cards.ts`.
  `MARKUP_VERSION` is still 2.
- **Production [verified 23 Sept]:** https://offer-mailer.matt-wilson-9b8.workers.dev/health → **v0.5.0**, db ok,
  images true, **`firecrawl:false`** (the production Firecrawl secret is not set). **Every `/api` route answers 503**
  until Cloudflare Access exists (IT). **The Worker was NOT redeployed for sessions 6–7:** the 22 Sept render/paste
  work, the offer-library rebuild, the terminology sweep and the campaign-copy feature are all in `main` and run only
  through `pnpm dev:live` — production is still the 21 Sept build. D1 **migrations 0000–0003 applied** (`0003` =
  `library_entries`, applied to the remote too, so `dev:live`'s Library tab works against production storage).
  `wrangler` is signed in as Matt with deploy rights. **Security:** production has `ACCESS_AUD` empty; `/api` is
  closed only because `DEV_USER_EMAIL` is not defined there. **Never set it in production.**
- **How the tool is actually used today [verified 23 Sept]:** locally, on production storage —
  `pnpm dev:live` (API on :8787, `wrangler dev --remote`) + `pnpm --filter @offer-mailer/web dev` (UI on
  http://localhost:5173, use `localhost` not `127.0.0.1`). **Plain `pnpm dev` uses local storage and must never be
  used for an email that will be sent**: its images, hosted page and tracked links point at production, which does
  not have them (all 404). `dev:live` writes real production data: test campaigns land in the production promotions
  register and should be wiped before go-live. `dev:live` also drops its Cloudflare session after a few hours (restart
  it; `wrangler login` if the token expired). Dev servers do not survive a session.
- **Firecrawl [verified 23 Sept]:** key in `apps/api/.dev.vars` (git-ignored); **3,148 of 5,000 credits left, period
  ends 9 Oct 2026**. A brochure search costs about 10–12 credits (22–24 when several documents are opened). Check the
  balance for free: `GET https://api.firecrawl.dev/v2/team/credit-usage` with the key as a bearer token.
- **What is in production storage [verified 23 Sept]** (all written through `dev:live`, none of it real customer
  data): **11 test campaigns** (in the promotions register — wipe before go-live), **3 library entries** (Renault 5
  personal, Polestar 2 personal, and Polestar 2 on the shared **EVs** shelf — the promote-is-copy proof), **4 rows in
  the legacy `offers` table**, **11 current brochures** (Abarth 500, Geely EX2, Jaecoo 8, Jeep Compass, Kia EV2,
  Nissan Micra, Polestar 2 [European edition, accepted by Matt], Renault 4, Renault 5, Škoda Enyaq, Toyota C-HR), the
  seeded placeholder template, one saved sender, no suppressions.
- **Roles [verified 23 Sept]:** `matt.wilson@dreamlease.co.uk` is the master admin (`config/admins.json`); any other
  `DEV_USER_EMAIL` is a salesperson.

## 3. What exists (build order, brief §8.2)

| Step | State |
|---|---|
| 1 Scaffold, schema, D1, Worker, Access middleware, deploy | Done, deployed |
| 2 `render()`, layouts, hosted page | Done. **One offer per row since 21 Sept** (1 → hero, 2+ → stacked rows); the grid cards were deleted 22 Sept |
| 3 URL lookup, image pipeline, brochures | Done. Brochures are the **finder** (no allowlist, `finder-1.4`: Map + the model's page operated inside Firecrawl), with a **European English-language fallback that is only ever OFFERED to the salesperson** |
| 4 Web app | Core screens built; runs locally only, **not yet served from the production Worker**. Sessions 6–7 added: the **offer library rebuilt as a curated repository** (personal + admin-curated shared shelves, priced live on use, URL-health flag, current/archived + 6-month purge — `architecture.md` B7c); an **identifiable Campaigns list + Copy a past campaign** that re-prices every offer live on copy; and a repo-wide **"rep" → "salesperson"** terminology sweep |
| 5 Graph draft / Copy for Outlook | Copy-for-Outlook done and is the only send path; Graph draft parked (IT Entra app) |
| 6 Redirects, click logging, stats | Done |
| 7 Template admin, approval, register, suppression | Done |
| 8 Stubs + `docs/evolution.md` | Not started (low value) |

## 4. The thing to understand before touching the email

**The send path is: Copy for Outlook → paste into a New Outlook message → send. Outlook rewrites what is pasted.**
Scope is **Gmail (web + app) and New Outlook (desktop + mobile)** only, for now (Matt, 21 Sept). From his real sends:

- **Survives the paste:** tables, widths and `max-width`, `display:inline-block`, backgrounds, borders, radius, bold,
  letter-spacing, link colours, images.
- **Lost:** the `<style>` block (so no media query, no forced-light overrides), the conditional comments (no ghost
  tables), a float's clearing spacer.
- **Found and confirmed fixed (22 Sept, Matt's real sends):** **text colour and font size arrive flattened** — the 28px
  red price and red make name arrive black and body-sized; white badge text arrives black — because Outlook pastes
  "from other apps" with **Merge formatting**, its default (Settings → Mail → Compose and reply → Cut, copy and
  paste). Proven from the sent `.eml` and through Outlook's own editor: no markup survives Merge formatting, and
  with **Keep source formatting** the same markup arrives red and 28px. The fix is the salesperson's paste mode, per
  paste (the "(Ctrl)" paste-options button) or as the default. `status-2026-09-21.md` §11.

So **nothing may depend on the media query or on `[if mso]`**. What was changed for that (all in `main`): fluid
wrapper (100% up to 600px); inline-block badge pills instead of floats; a calc()-fluid image column in the stack
card; auto layout 1 → single, 2+ → stack; layout picker removed. Matt's verdict on the re-test: "100% better".

## 5. Open items, in the order I would take them

1. **A test send from the current `main`** — the only thing that closes the loop and the one thing only Matt can do.
   Everything of sessions 6–7 (library, copy) is client/API behaviour proven live in the tool, but the *email* is
   unchanged since 22 Sept; a Keep-source-formatting send confirms nothing regressed. Lead with this.
2. **Offer-library follow-ups** (B7c, all small, none blocking):
   - **Auto-archive on expiry.** The URL recheck flags moved/gone sources and the manual archive/unarchive routes
     exist; an **expiry-based** auto-archive trigger (offer past `validUntil`) is still to wire.
   - **A "re-point the URL" editor** for a flagged entry — today the salesperson re-fetches from Compose and re-saves.
   - **Drop the legacy `offers` table** once nothing references it (4 rows in prod; superseded by `library_entries`).
3. **Salesperson curation of their own campaigns beyond copy** (rename / archive a campaign) — floated, not built.
   Copy is done; campaigns still never flow into the library.
4. **Brochure finder** — Matt: "It's not set up properly… must be resolved", then "You are not leveraging Firecrawl
   capability to its optimum." Discovery was rebuilt as **finder-1.4** (design in `architecture.md` B7b; the day's
   story in `status-2026-09-21.md` §8–§10) and proven on 17 cars: 13 right attachments, 3 correct one-click offers,
   1 correct nothing. **He has not said it is resolved.** What to know:
   - **A reported miss: read the stored trace first** — production D1 `brochure_searches`, by `vehicle_key`. It
     records the queries, the pages opened, and for every document how it was discovered, the action taken and why
     it was dropped.
   - **Prove any change with the live sweep** (`packages/adapters/scripts/finder-sweep.mts`, about 10 credits a car)
     **and read the traces, not the score**: the first sweep found three WRONG attachments 200 tests had not.
   - **Known weak spots:** a brochure that only appears after a model is chosen in a form (Kia UK); price-list hubs
     offered as a page rather than followed to the model's file (Peugeot, Volvo); a variant taken for the model
     (Puma Gen-E). Most of DreamLease's range has not been swept.
   - **Matt's ruling (final):** a European English-language edition is **offered, never attached by itself**; a copy
     another salesperson accepted arrives unticked.
5. **Badge control** — a decision first: fixed approved list (what `CLAUDE.md` rule 3, the brief and the schema all
   say today) or free-text-but-logged. Earlier notes "recommended" free text; that would mean rewriting rule 3, so it
   is Matt's call, not a default.
6. BCH / salary-sacrifice processing fee (PCH forces £299.99; the other two undecided). Step 8 stubs (low value).
7. Rendering assurance (`architecture.md` A5: certify per markup version on real clients, certify the send path,
   pre-send check in the tool) — proposed, deliberately parked by Matt in favour of agile test sends.

## 6. Blocks go-live (owed by others)

- **IT:** Cloudflare Access (unblocks production `/api`) + a **Cloudflare-served subdomain**. `mailer.dreamlease.co.uk`
  is **already taken** by an unrelated host; `offers.` is free; DNS is at GoDaddy (project memory
  `custom-domain-setup-parked`). Plus the Graph Entra app. **The one-page IT runbook is written**
  (`docs/it-runbook-sign-in.md`, with a data-protection section) — hand it over.
- **Redeploy the Worker for sessions 6–7** — the library, campaign copy and terminology sweep are in `main` but not on
  the production Worker (still v0.5.0). `pnpm run deploy` when Matt wants them live; it is deferred with the rest of
  go-live behind Access + the subdomain.
- **Serve the web app from the production Worker** — not built.
- **Emma:** approved compliance wording for PCH / BCH / salary sacrifice (the live template is a placeholder);
  the brochure small print including the new European-edition sentence; the campaign retention period.
- **Matt:** the production Firecrawl secret; confirm the Workers Paid plan (not verifiable from the repo).

## 7. Known-good facts & gotchas

- **The Library tab needs the `library_entries` table.** It is on production D1 now (migration `0003`), so `dev:live`
  works. Local `pnpm dev` needs `pnpm db:migrate:local` first (an interactive prompt) before its Library tab works.
- **Copy a past campaign is client-only and re-prices live.** It sets Compose state from the campaign (offers +
  reusable parts, never the recipient) and `Compose.tsx` `repriceCopied` re-fetches each offer from its source URL; a
  moved/gone source keeps the copied price and is flagged, salary-sacrifice nets are preserved, brochures are not
  carried. **Campaigns never write to `library_entries`.**
- **Promote = copy, admin-only.** Promoting a personal library entry creates an independent shared entry (new id,
  admin as owner); the salesperson keeps theirs. The Promote button only renders for admins (`config/admins.json`).
- **Shared shelves** live in `config/library-shelves.json` (admin-extensible): PCH latest deals, BCH latest deals, EVs
  (manual) and Deals under £300 per month (**smart**, filtered live on the `monthly` facet). "category" on an entry is
  a free label — nothing there is a hard limit.
- Initial payment is `initial-months × monthly`; a "1-month" offer showing `initial == monthly` is config, not a bug.
- The car image renders on black only in plain local `wrangler dev`; production (and `dev:live`) render white.
- Links inside a *preview* iframe 404 ("Link not found.") — expected; only a created campaign has links.
- Copy for Outlook copies the campaign **as created**. Since 22 Sept any change to the offers, including a Library
  add, drops the created result so the button cannot hand out a stale email; the salesperson presses Create again
  (`status-2026-09-21.md` §13).
- "View offer" already deep-links with the salesperson's configured terms. No change needed.
- Template admin needs all three audience blocks; the seeded default template is a **placeholder, not Emma-approved**,
  and seeds itself into an empty database on first use.
- A brochure "nothing found" is remembered 7 days; a search that never reached the official site only 1 day; a
  failed search never; and nothing is remembered across a finder rules change (`FINDER_VERSION`), so bumping it
  re-runs, and re-pays for, every remembered miss.
- The site HTML-encodes text inside its own script block ("Techno &#x2B; Comfort"): the lookup decodes it, a
  cached lookup that still carries an entity refreshes itself, and an offer is decoded again wherever it reaches the
  server (library save / list, campaign preview / create: `packages/schema/src/text.ts`). If a name shows `&…;`,
  that is where to look.
- The page-operating script (`brochure/operate.ts`) runs inside Firecrawl's browser in ONE scrape with `actions`
  (1 credit). It must never press request / test-drive / configurator controls or submit anything.
- Windows shell: a long heredoc with backticks and apostrophes can fail in the Bash tool; write the script to a
  file and run it. Line endings: `model.ts` is CRLF in the working copy (autocrlf), which is normal.
- The four rules (`CLAUDE.md`) are load-bearing: **CAP IDs never stored; three layers no leaks (`render()` is the
  only HTML producer); compliance locked; drafts only.**

## 8. Start

Confirm in a few lines that you have read the docs above; state the git, test and live state as you find them
(`git status`, `git log --oneline -5`, `pnpm test`, `/health`); then ask Matt which of §5 he wants, leading with the
thing only he can do: a test send from the current `main`, made with Keep source formatting. Propose nothing else
until he answers.
