# Pickup prompt — DreamLease Offer Mailer

Paste everything below the line into a new Claude Code session opened in `C:\Users\MatthewWilson\email-offer-builder`.
**Rewritten 21 September 2026 (end of session 5).** It supersedes all earlier pickup prompts. Every state claim is
marked **[verified 21 Sept]** (checked against the repo or the live system that day) or **[asserted]** (recorded,
not re-checked). Verify before you act: run the pickup-verify skill if it is available.

---

You are resuming the **DreamLease Offer Mailer**: an internal tool where a sales rep pastes a dreamlease.co.uk
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
- **No multi-agent / workflow runs unless he asks** (`CLAUDE.md`). He hit his usage limit mid-session on 21 Sept. One
  read-only doc audit was run that day because he asked for every design document to be updated; it was worth it
  (39 stale claims), but it is not the default.
- Commit only when asked. Report the live system's state plainly after any deploy.

## 1. Read these, in order

1. `CLAUDE.md` — the four rules that never bend, the current rendering scope, the working agreement, commands.
2. **This file.**
3. **`docs/architecture.md`** — the authoritative Solution Design & System Architecture. **A5 (the real send path),
   B7 (rendering and the deviations from the v5 reference) and B7b (the brochure finder, in one place) are the parts
   that changed most recently.**
4. **`docs/status-2026-09-21.md`** — the current build log, one long day in five parts. §0 is the summary; §1–§6 the
   European brochure fallback; §7 the real test sends and one offer per row; §8 the first finder misses (Renault 4,
   Geely EX2); §9 finder-1.4 and the 17-car sweep; §10 the European edition becoming an OFFER, and the name-entity
   fix. Older status files are history.
5. `docs/brochure-finder-brief.md` — the brochure finder's design and evidence (read its status banner first).
6. `docs/dreamlease-offer-mailer-brief.md` — the product brief (v1.1); §5 is the shared contract, **§9a is the
   as-built log** (where the build has left the brief).
7. `docs/offer-mailer-implementation-notes.md` — the v5 markup reference; **read its 21 Sept status block first**,
   several of its non-negotiables no longer hold as written.

## 2. Repo & live state

- **Git [verified 21 Sept]:** branch `main`, pushed to `origin` = `https://github.com/DreamLeaseUK/email-offer-builder`
  (private). `git push` works through the stored credential. The `brochure-finder` branch is fully merged and can be
  deleted. Working tree clean at the end of session 5 (HEAD is the commit that last touched this file). Run
  `git log --oneline -20` for the session-5 commits.
- **Tests [verified 22 Sept]:** `pnpm test` → **214 pass** (schema 23, render 37, adapters 92, api 62);
  `pnpm typecheck` clean. There is **no CI**: the tests are the only gate. `diff-reference` reports **22** differing
  lines: 8 pre-date 21 Sept (2 the logo width, 6 the third hero pill), 14 are the inline-block pills (10) and the
  stack card's image column (4); the fluid wrapper is outside the sections it compares. All are recorded in the
  header of `packages/render/src/cards.ts`. `MARKUP_VERSION` is still 2.
- **Production [verified 21 Sept]:** https://offer-mailer.matt-wilson-9b8.workers.dev/health → **v0.5.0**, db ok,
  images true, **`firecrawl:false`** (the production Firecrawl secret is not set). **Every `/api` route answers 503**
  until Cloudflare Access exists (IT). D1 migrations 0000–0002 applied. `wrangler` is signed in as Matt with deploy
  rights. **Security:** production has `ACCESS_AUD` empty; `/api` is closed only because `DEV_USER_EMAIL` is not
  defined there. Never set it in production.
- **How the tool is actually used today [verified 21 Sept]:** locally, on production storage —
  `pnpm dev:live` (API on :8787, `wrangler dev --remote`) + `pnpm --filter @offer-mailer/web dev` (UI on
  http://localhost:5173, use `localhost` not `127.0.0.1`). **Plain `pnpm dev` uses local storage and must never be
  used for an email that will be sent**: its images, hosted page and tracked links point at production, which does
  not have them (all 404). `dev:live` writes real production data: test campaigns are in the production promotions
  register and should be wiped before go-live. Dev servers do not survive a session.
- **Firecrawl [verified 21 Sept]:** key in `apps/api/.dev.vars` (git-ignored); 3,218 of 5,000 credits left, period
  ends 9 Oct (about 780 were spent on 21 Sept, half of it on the sweeps). A brochure search costs about 10–12
  credits (22–24 when several documents are opened). Check the balance for free:
  `GET https://api.firecrawl.dev/v2/team/credit-usage` with the key as a bearer token.
- **What is in production storage [verified 21 Sept]** (all written through `dev:live`, none of it real customer
  data): 3 test campaigns (in the promotions register: wipe before go-live), 3 library offers, the seeded
  placeholder template, no saved sender, and 8 current brochures — Geely EX2, Jaecoo 8, Kia EV2, Nissan Micra,
  Polestar 2 (the European edition, accepted by Matt), Renault 4, Renault 5, Toyota C-HR. Matt's own searches since
  finder-1.4 (Micra, Jaecoo 8, Kia EV2, Renault 5) all found the document.
- **Roles:** `matt.wilson@dreamlease.co.uk` is the master admin (`config/admins.json`); any other `DEV_USER_EMAIL`
  is a salesperson.

## 3. What exists (build order, brief §8.2)

| Step | State |
|---|---|
| 1 Scaffold, schema, D1, Worker, Access middleware, deploy | Done, deployed |
| 2 `render()`, layouts, hosted page | Done. **One offer per row since 21 Sept** (1 → hero, 2+ → stacked rows); grids dormant |
| 3 URL lookup, image pipeline, brochures | Done. Brochures are the **finder** (no allowlist, `finder-1.4`: Map + the model's page operated inside Firecrawl), with a **European English-language fallback that is only ever OFFERED to the rep** |
| 4 Web app | Core screens built; runs locally only, **not yet served from the production Worker** |
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
- **Found (22 Sept), awaiting Matt's confirming send:** **text colour and font size arrive flattened** — the 28px
  red price and red make name arrive black and body-sized; white badge text arrives black — because Outlook pastes
  "from other apps" with **Merge formatting**, its default (Settings → Mail → Compose and reply → Cut, copy and
  paste). Proven from the sent `.eml` and through Outlook's own editor: no markup survives Merge formatting, and
  with **Keep source formatting** the same markup arrives red and 28px. The fix is the rep's paste mode, per paste
  (the "(Ctrl)" paste-options button) or as the default. `status-2026-09-21.md` §11.

So **nothing may depend on the media query or on `[if mso]`**. What was changed for that (all in `main`): fluid
wrapper (100% up to 600px); inline-block badge pills instead of floats; a calc()-fluid image column in the stack
card; auto layout 1 → single, 2+ → stack; layout picker removed. Matt's verdict on the re-test: "100% better".

## 5. Open items, in the order I would take them

1. **Flattened colour / size on the paste path** (§4) — cause found and the Copy for Outlook screen now tells the rep
   to paste with Keep source formatting (22 Sept); Matt still to confirm with a real send made that way.
2. **Small print order on a phone** — in the stack card it sits under the image, so on a phone it reads before the
   car's name and price. Proposed: move it below the button. **Matt has not answered; do not build unasked.**
3. **Delete the dormant grid code** (`halfCard`, `compactCard`, `match.ts`, `measure.ts`, the grid tests) once Matt
   confirms the stacked layout in Gmail and Outlook mobile. He has not been asked since "100% better".
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
     another rep accepted arrives unticked. Three calls from that morning he can still overturn: brochures only in
     the fallback; a euro-priced European brochure is still offered, flagged; a document that does not say its
     market is refused.
5. **Badge control** — a decision first: fixed approved list (what `CLAUDE.md` rule 3, the brief and the schema all
   say today) or free-text-but-logged. Earlier notes "recommended" free text; that would mean rewriting rule 3, so it
   is Matt's call, not a default.
6. BCH / salary-sacrifice processing fee (PCH forces £299.99; the other two undecided). Step 8 stubs (low value).
7. Rendering assurance (`architecture.md` A5: certify per markup version on real clients, certify the send path,
   pre-send check in the tool) — proposed, deliberately parked by Matt in favour of agile test sends.

## 6. Blocks go-live (owed by others)

- **IT:** Cloudflare Access (unblocks production `/api`) + a **Cloudflare-served subdomain**. `mailer.dreamlease.co.uk`
  is **already taken** by an unrelated host; `offers.` is free; DNS is at GoDaddy (project memory
  `custom-domain-setup-parked`). Plus the Graph Entra app. A one-page IT runbook was offered, never written.
- **Serve the web app from the production Worker** — not built.
- **Emma:** approved compliance wording for PCH / BCH / salary sacrifice (the live template is a placeholder);
  the brochure small print including the new European-edition sentence; the campaign retention period.
- **Matt:** the production Firecrawl secret; confirm the Workers Paid plan (not verifiable from the repo).

## 7. Known-good facts & gotchas

- Initial payment is `initial-months × monthly`; a "1-month" offer showing `initial == monthly` is config, not a bug.
- The car image renders on black only in plain local `wrangler dev`; production (and `dev:live`) render white.
- Links inside a *preview* iframe 404 ("Link not found.") — expected; only a created campaign has links.
- "View offer" already deep-links with the rep's configured terms. No change needed.
- Template admin needs all three audience blocks; the seeded default template is a **placeholder, not Emma-approved**,
  and seeds itself into an empty database on first use.
- A brochure "nothing found" is remembered 7 days; a search that never reached the official site only 1 day; a
  failed search never; and nothing is remembered across a finder rules change (`FINDER_VERSION`), so bumping it
  re-runs, and re-pays for, every remembered miss.
- The site HTML-encodes text inside its own script block ("Techno &#x2B; Comfort"): the lookup decodes it, a
  cached lookup that still carries an entity refreshes itself, and since 22 Sept an offer is decoded again wherever
  it reaches the server (library save / list, campaign preview / create: `packages/schema/src/text.ts`). Two test
  campaigns of 21 Sept (13:22 and 13:36) still carry the entity in their stored snapshot and hosted page. If a name
  shows `&…;`, that is where to look.
- The page-operating script (`brochure/operate.ts`) runs inside Firecrawl's browser in ONE scrape with `actions`
  (1 credit). It must never press request / test-drive / configurator controls or submit anything.
- Windows shell: a long heredoc with backticks and apostrophes can fail in the Bash tool; write the script to a
  file and run it. Line endings: `model.ts` is CRLF in the working copy (autocrlf), which is normal.
- The four rules (`CLAUDE.md`) are load-bearing: **CAP IDs never stored; three layers no leaks (`render()` is the
  only HTML producer); compliance locked; drafts only.**

## 8. Start

Confirm in a few lines that you have read the docs above; state the git, test and live state as you find them
(`git status`, `git log --oneline -5`, `pnpm test`, `/health`); then ask Matt which of §5 he wants, leading with the
two things only he can unblock: the Keep-source-formatting test send (§5.1) and the small-print decision (§5.2). Propose
nothing else until he answers.
