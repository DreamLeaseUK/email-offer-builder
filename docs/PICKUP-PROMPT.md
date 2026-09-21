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
- Commit only when asked. Report the live system's state plainly after any deploy.

## 1. Read these, in order

1. `CLAUDE.md` — the four rules that never bend, the current rendering scope, the working agreement, commands.
2. **This file.**
3. **`docs/architecture.md`** — the authoritative Solution Design & System Architecture. **A5 (the real send path)
   and B7 (rendering and the deviations from the v5 reference) are the parts that changed most recently.**
4. **`docs/status-2026-09-21.md`** — the current build log. §0 is the summary; §1–§6 the brochure fallback; §7 the
   test sends and the one-offer-per-row change. Older status files are history.
5. `docs/brochure-finder-brief.md` — the brochure finder's design and evidence (read its status banner first).
6. `docs/dreamlease-offer-mailer-brief.md` — the product brief (v1.1); §5 is the shared contract, **§9a is the
   as-built log** (where the build has left the brief).
7. `docs/offer-mailer-implementation-notes.md` — the v5 markup reference; **read its 21 Sept status block first**,
   several of its non-negotiables no longer hold as written.

## 2. Repo & live state

- **Git [verified 21 Sept]:** branch `main`, pushed to `origin` = `https://github.com/DreamLeaseUK/email-offer-builder`
  (private). `git push` works through the stored credential. The `brochure-finder` branch is fully merged and can be
  deleted. Run `git log --oneline -12` for the session-5 commits.
- **Tests [verified 21 Sept]:** `pnpm test` → **207 pass** (schema 18, render 37, adapters 92, api 60);
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
- **Firecrawl [verified 21 Sept]:** key in `apps/api/.dev.vars` (git-ignored); 3,238 of 5,000 credits left, period
  ends 9 Oct. A brochure search costs about 10–12 credits (22–24 when several documents are opened).
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
- **OPEN, not fixed:** **text colour and font size arrive flattened** — the 28px red price and red make name arrive
  black and body-sized, in Gmail and Outlook alike; white badge text arrives black. Leading suspect: Outlook's
  "merge formatting" paste option. **Blocked on evidence Matt has been asked for three times:** the as-received
  source (Gmail → ⋮ → Show original → Download original) and which paste option Outlook used. Ask again, or ask for
  his OK to pull it from his Gmail in Chrome. Do not guess a fix.

So **nothing may depend on the media query or on `[if mso]`**. What was changed for that (all in `main`): fluid
wrapper (100% up to 600px); inline-block badge pills instead of floats; a calc()-fluid image column in the stack
card; auto layout 1 → single, 2+ → stack; layout picker removed. Matt's verdict on the re-test: "100% better".

## 5. Open items, in the order I would take them

1. **Flattened colour / size on the paste path** (§4) — needs the as-received source first.
2. **Small print order on a phone** — in the stack card it sits under the image, so on a phone it reads before the
   car's name and price. Proposed: move it below the button. **Matt has not answered; do not build unasked.**
3. **Delete the dormant grid code** (`halfCard`, `compactCard`, `match.ts`, `measure.ts`, the grid tests) once Matt
   confirms the stacked layout in Gmail and Outlook mobile. He has not been asked since "100% better".
4. **Brochure finder reliability — Matt: "It's not set up properly… must be resolved", then "You are not leveraging
   Firecrawl capability to its optimum."** Discovery was rebuilt as finder-1.4 on 21 Sept (`status-2026-09-21.md`
   §9) and proven on 17 cars: 13 right attachments, 3 correct one-click offers, 1 correct nothing. Known weak spots:
   a brochure that only appears after a model is chosen in a form (Kia UK), price-list hubs offered as a page
   (Peugeot, Volvo), a variant taken for the model (Puma Gen-E). The rest of DreamLease's range has not been swept.
   To prove any finder change run `packages/adapters/scripts/finder-sweep.mts` and READ THE TRACES: the first
   sweep found three wrong attachments the tests had not. When he reports a miss:
   read the stored trace first (production D1 `brochure_searches`, by `vehicle_key`) — it says exactly where the
   document was lost. Matt has ruled on one of the morning's calls: a European edition is OFFERED, never attached by itself
   (`status-2026-09-21.md` §10). Three calls he can still overturn (`status-2026-09-21.md` §5): brochures only in the
   fallback; a euro-priced European brochure is still offered (flagged); an unmarked-market document is refused. Test more brands; failures show as traces.
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
- A brochure "nothing found" is remembered 7 days, but not across a finder rules change (`FINDER_VERSION`).
- Windows shell: a long heredoc with backticks and apostrophes can fail in the Bash tool; write the script to a
  file and run it. Line endings: `model.ts` is CRLF in the working copy (autocrlf), which is normal.
- The four rules (`CLAUDE.md`) are load-bearing: **CAP IDs never stored; three layers no leaks (`render()` is the
  only HTML producer); compliance locked; drafts only.**

## 8. Start

Confirm in a few lines that you have read the docs above; state the git, test and live state as you find them
(`git status`, `git log --oneline -5`, `pnpm test`, `/health`); then ask Matt which of §5 he wants, leading with the
two things only he can unblock: the as-received Gmail source (§5.1) and the small-print decision (§5.2). Propose
nothing else until he answers.
