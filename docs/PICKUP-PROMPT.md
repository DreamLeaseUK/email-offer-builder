# Pickup prompt — DreamLease Offer Mailer

Paste everything below the line into a new Claude Code session opened in `C:\Users\MatthewWilson\email-offer-builder`.
**Updated 24 September 2026 (end of session 8).** It supersedes all earlier pickup prompts. Every state claim is
marked **[verified 24 Sept]** (checked against the repo or the live system that day) or **[asserted]** (recorded,
not re-checked). Verify before you act: run the pickup-verify skill if it is available.

---

You are resuming the **DreamLease Offer Mailer**: an internal tool where a salesperson pastes a dreamlease.co.uk
vehicle URL, assembles a branded HTML email of one to six lease offers, and gets Outlook-ready HTML plus a hosted
web page. It is an FCA-regulated financial-promotions tool (compliance matters).

## 0. How to behave with Matt (read this first)

- Matt is Head of Marketing and the only stakeholder. He is **blunt, direct, and has zero patience for waffle,
  hedging, or process-for-its-own-sake.** Give him substance, evidence and decisions — not essays.
- **Do not start a build step, review, diagnostic, or any new work without an explicit instruction.** "Continue" is
  not one. Before a new step, say in one or two lines what it is / changes / costs, then **wait**. The exception is a
  quick change he has just asked for (the screenshot changes below): state it, do it, prove it, report.
- Do **not** hide behind "compliance sign-off needed" as a reason not to build. Where a human check genuinely
  matters, build it *into* the flow, don't make it a gate.
- He works **agile, by real test sends and screenshots**: he makes a campaign, pastes it into New Outlook, sends it
  to Gmail and Outlook, and sends you screenshots. He also fires quick UI changes from screenshots ("remove the !",
  "move this above that") — do them, prove them (typecheck, tests, `diff-reference` when render changes), report in
  a few lines. Do not answer a rendering problem with a process proposal.
- When you claim something works, **prove it** (a live call, a test run, a measurement in a real browser).
- When he reports a fault, **read the evidence before theorising**: the stored brochure trace, the stored campaign,
  the page itself. On 21 Sept every finder miss was a specific defect in the trace; on 23 Sept the "brochure not
  saved" report was diagnosed from production D1 rows, not guessed (`status-2026-09-24.md` §3).
- He sometimes pastes an analysis from elsewhere as the direction to take. Take it as the brief, say where it has to
  be adapted to this system, and build it.
- **He is not the Entra/IT administrator.** Anything IT does needs click-by-click instructions a non-technical
  person can follow from their screen, checked against the vendor's current docs (he got a Word document on 24 Sept).
- He is on **Windows, PowerShell**. `pnpm` **is** on his PowerShell PATH (`%AppData%\npm\pnpm.ps1`, execution policy
  RemoteSigned) [verified 24 Sept]; if it ever fails there, the full path `%AppData%\npm\pnpm.cmd` works. Give him
  commands that work in PowerShell.
- **No multi-agent / workflow runs unless he asks** (`CLAUDE.md`) — even when a session is set to prefer them, this
  standing rule wins; do the work solo.
- Commit only when asked; he commits directly to `main` and asked for pushes on 23 Sept. Report the live system's
  state plainly after any deploy.
- **A block list stops you (since 24 Sept):** deploys, `dev:live`, both `db:migrate` commands, `wrangler d1 execute`
  (reads included), the Cloudflare connector's D1 query and writes, history-destroying git (`reset --hard`,
  `push --force`, `clean`, `stash`, `restore`) and reading secret files (`.dev.vars`, `.env`). Matt runs those in the
  desktop app's Terminal panel. For a production D1 read, give him the exact SELECT and ask for the output. The full
  list is in `CLAUDE.md` → Working with Matt.

## 1. Read these, in order

1. `CLAUDE.md` — the four rules that never bend, the current rendering scope, the working agreement, commands.
2. **This file.**
3. **`docs/status-2026-09-24.md`** — the current build log (session 8): what was built, the evidence, Matt's
   decisions, sign-in progress, local running and sharing. Then `status-2026-09-23.md` (the offer-library rebuild,
   campaign copy) and `status-2026-09-21.md` (the finder day, the paste fix) as history.
4. **`docs/architecture.md`** — the authoritative Solution Design & System Architecture. Changed most recently:
   **A2 (Track) / A3** (the feature list), **B3** (starting the servers; sharing the tool through a tunnel),
   **B6** (the Entra status), **B7** ("Inbox preview" and "Attribution"), **B7c** ("Brochures ride along on use").
5. `docs/it-runbook-sign-in.md` — Cloudflare Access + Entra ID; Part A was rewritten on 24 Sept for a non-technical
   administrator, with team `dreamlease` filled in.
6. `docs/brochure-finder-brief.md` — the brochure finder's design and evidence (read its status banner first).
7. `docs/dreamlease-offer-mailer-brief.md` — the product brief (v1.1); §5 is the shared contract, **§9a is the
   as-built log** (latest entry: 23–24 Sept).
8. `docs/offer-mailer-implementation-notes.md` — the v5 markup reference; **read its 21 Sept status block first**,
   several of its non-negotiables no longer hold as written.

## 2. Repo & live state

- **Git [verified 24 Sept]:** branch `main`, `origin` = `https://github.com/DreamLeaseUK/email-offer-builder`
  (private), everything pushed. Session 8's code commits: `ac10c47` (badge "!"), `dd8de0d` (auto-preheader,
  plain greeting, salesperson UTM), `666d2ad` (library brochure re-attach), `7ae069e` (web: brochure carry-over,
  Compose form, resizable panels, header photo). Then on 24 Sept: `4edec9c` (session-8 docs, review fixes, the tunnel
  `allowedHosts`, `.claude/launch.json`), PR #1 merged as `399c86b` (CI), and a docs commit recording CI. Check
  `git status` and `git log --oneline -5` for anything newer.
- **Tests [verified 24 Sept]:** `pnpm test` → **234 pass** (schema 23, render 35, adapters 92, api 84, incl. the
  OpenAPI drift guard and the security tests; the API is described at `/api/openapi.json`, `architecture.md` B5/B12);
  `pnpm typecheck` clean (incl. `apps/web`); `apps/web` builds. **CI [verified 24 Sept]:** since PR #1 (merged
  24 Sept), GitHub Actions runs `ci.yml` (typecheck, tests, web build, and a guard that `DEV_USER_EMAIL` never
  reaches the committed vars) and `security.yml` (gitleaks, full history) on every pull request and push to `main`.
  `.gitleaks.toml` allowlists one verified false positive (`vehicleKey` slugs); any new entry there needs a reason. `diff-reference`
  reports **84** differing lines (2 logo width, 6 the third hero pill, 10 inline-block pills + the stack image column,
  64 the name-before-picture reorder, 2 the plain greeting of 23 Sept), all recorded in the `cards.ts` header.
  `MARKUP_VERSION` is still 2.
- **Production [verified 24 Sept]:** https://offer-mailer.matt-wilson-9b8.workers.dev/health → **v0.5.0**, db ok,
  images true, **`firecrawl:false`**; **`/api` answers 503** until Cloudflare Access exists. **The Worker has NOT been
  redeployed for sessions 6–8**: all of it runs only through `pnpm dev:live`. D1 migrations 0000–0003 applied
  (remote too). `wrangler` is signed in as Matt. **Security:** production has `ACCESS_AUD` empty; `/api` is closed
  only because `DEV_USER_EMAIL` is not defined there. **Never set it in production.**
- **How the tool is run today [verified 24 Sept]:** locally, on production storage. `.claude/launch.json` defines
  `api-live` (`pnpm dev:live`, :8787) and `web` (Vite, http://localhost:5173 — use `localhost`) — start them with the
  desktop app's preview tools; they stop when the app's Browser pane is closed ("restart localhost" = start both).
  Plain `pnpm dev` (local storage) must never be used for an email that will be sent. `dev:live` writes real
  production data and drops its Cloudflare session after a few hours.
- **Sharing the running tool [verified 24 Sept]:** no LAN, so a Cloudflare quick tunnel —
  `& "$HOME\cloudflared.exe" tunnel --url http://localhost:5173` (binary at `C:\Users\MatthewWilson\cloudflared.exe`).
  **The address is random and new on every start** (Matt asked to "reconnect" an old one — impossible; give the new
  one). Anyone with it is signed in as Matt (admin) on production data, with no login, so share it with one person
  and stop the tunnel as soon as they are done. `architecture.md` B3.
- **Firecrawl [asserted 23 Sept]:** key in `apps/api/.dev.vars` (git-ignored); 3,148 of 5,000 credits, period ends
  9 Oct 2026; no finder searches were run in session 8. Free balance check:
  `GET https://api.firecrawl.dev/v2/team/credit-usage` with the key as a bearer token.
- **Production storage [asserted 23 Sept, not re-counted]** (all test data from `dev:live`): about 11 test campaigns
  on 23 Sept — **more were created in session 8's testing**; 3 library entries (Renault 5 personal, Polestar 2
  personal + on the shared EVs shelf); 4 legacy `offers` rows; 11 current brochures incl. `renault/5` (verified in
  D1 on 23 Sept); the placeholder template; one saved sender (with a headshot); no suppressions. Wipe test campaigns
  from the promotions register before go-live.
- **Roles [asserted]:** `matt.wilson@dreamlease.co.uk` is the master admin (`config/admins.json`).

## 3. What exists (build order, brief §8.2)

| Step | State |
|---|---|
| 1 Scaffold, schema, D1, Worker, Access middleware, deploy | Done, deployed |
| 2 `render()`, layouts, hosted page | Done. One offer per row (1 → hero, 2+ → stacked). Since 23 Sept: the inbox preview is **derived from the intro**; the greeting is **plain** |
| 3 URL lookup, image pipeline, brochures | Done. The **finder** (`finder-1.4`), with a European English-language fallback that is only ever OFFERED |
| 4 Web app | Core built; runs locally only, not yet served from the Worker. Sessions 6–7: the curated **offer library** (B7c), the identifiable **Campaigns list + Copy**. Session 8: **brochures carried through library use and copy**, preheader field removed, recipient above the intro, **resizable Compose panels**, **portrait in the header** |
| 5 Graph draft / Copy for Outlook | Copy for Outlook is the only send path. Graph draft **removed** (24 Sept) — **next delivery path is monday.com's email tool** |
| 6 Redirects, click logging, stats | Done. Since 23 Sept every website link also carries **`utm_term=<salesperson>`** |
| 7 Template admin, approval, register, suppression | Done |
| 8 Stubs + `docs/evolution.md` | Not started (low value; the `monday` stub is now the real next delivery path) |

## 4. The thing to understand before touching the email

**The send path is: Copy for Outlook → paste into a New Outlook message → send. Outlook rewrites what is pasted.**
Scope is **Gmail (web + app) and New Outlook (desktop + mobile)** only (Matt, 21 Sept). From his real sends:

- **Survives the paste:** tables, widths and `max-width`, `display:inline-block`, backgrounds, borders, radius, bold,
  letter-spacing, link colours, images.
- **Lost:** the `<style>` block (so no media query, no forced-light overrides), the conditional comments (no ghost
  tables), a float's clearing spacer.
- **Text colour and size arrive flattened with Outlook's default "Merge formatting" paste**; with **Keep source
  formatting** the markup arrives as designed (22 Sept, proven). The Copy-for-Outlook helper tells the salesperson.

So **nothing may depend on the media query or on `[if mso]`**. The email has **not had a real test send since
22 Sept**: the intro-derived preheader (a hidden div — check the inbox list, not the preview) and the plain greeting
are unproven in real clients.

## 5. Open items, in the order I would take them

1. **A test send from the current `main`** (Keep source formatting → Gmail + New Outlook). Confirms nothing
   regressed and is the first real check of the inbox preview and the plain greeting. Only Matt can do it. Lead with it.
2. **Sign-in.** Matt sends IT the Word document ("DreamLease Offer Mailer - Entra sign-in setup.docx", in his
   Documents; same content as runbook Part A). IT returns: Application (client) ID, Directory (tenant) ID, client
   secret Value (not by email), expiry date. Then runbook Part B (Cloudflare: Entra as IdP, the Access application on
   the `api` path, policy), set `ACCESS_TEAM_DOMAIN=dreamlease.cloudflareaccess.com` + `ACCESS_AUD` **in
   `apps/api/wrangler.jsonc`** (runbook B5), bump `APP_VERSION` to 0.6.0, then Matt deploys — which also ships
   sessions 6–8, so do the test send first. The full go-live list is §6.
3. **Offer-library follow-ups** (B7c, small): expiry-based auto-archive; a "re-point the URL" editor; drop the legacy
   `offers` table.
4. **Campaign curation beyond copy** (rename / archive) — floated, not built.
5. **Brochure finder** — Matt has not said it is resolved. A reported miss: read production D1 `brochure_searches`
   by `vehicle_key` first; prove any change with the live sweep (`packages/adapters/scripts/finder-sweep.mts`) and
   read the traces. Known weak spots: brochures behind a model-picker form (Kia UK), price-list hubs (Peugeot, Volvo),
   a variant taken for the model (Puma Gen-E).
6. **Badge control** — fixed list (rule 3, today) vs free-text-but-logged: Matt's call.
7. BCH / salary-sacrifice processing fee; rendering assurance (A5) — both parked.
8. **Later: the monday.com delivery adapter** — a new rendering target to prove with real sends.

## 6. Go-live

**Target: Thursday 1 October 2026, two salespeople. The date is flexible (Matt, 24 Sept): get it right rather than
rush it.** In order:

1. **Build: serve the web app from the production Worker.** Not built, and the biggest item; it is development
   work, not something owed by others. `wrangler.jsonc` already reserves the static-assets folder (`./public`).
   Plan it and get Matt's OK before building.
2. **IT:** the one Entra app registration (runbook Part A / the Word document) → four values back to Matt.
3. **Matt:** runbook Part B in Cloudflare (Entra as the identity provider, the Access application on the workers.dev
   hostname with path `api`, the policy) → the AUD tag. Also the production Firecrawl secret and confirming the
   Workers Paid plan.
4. **Deploy config:** `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` go in `apps/api/wrangler.jsonc` (runbook B5), never only
   in the dashboard, because a deploy replaces dashboard-set vars with the file's. Bump `APP_VERSION` to 0.6.0 so
   `/health` shows the new build.
5. **Emma:** approved compliance wording for PCH / BCH / salary sacrifice (the live template is a placeholder); the
   brochure small print incl. the European-edition sentence; the campaign retention period.
6. **Wipe the test campaigns** from the production promotions register (§2). Matt runs the statement.
7. **Deploy:** after a test send from `main`, Matt runs `pnpm run deploy`, which ships sessions 6–8. Then verify
   `/health` shows 0.6.0, `/api` sits behind Access, and a hosted page opens with no login.

**Custom domain, not needed for go-live:** the tool goes on **`marketingtools.dreamlease.co.uk`** (Matt, 24 Sept)
and the public links on `offers.dreamlease.co.uk`; both are free, and `mailer.` is taken. DNS is at GoDaddy, so the
subdomain must first become Cloudflare-served (runbook Part C; project memory `custom-domain-setup-parked`).
`TOOL_BASE_URL` still says `mailer.`, but nothing reads it at runtime.

## 7. Known-good facts & gotchas

- **Brochures ride along (23 Sept).** A brochure is stored per `vehicleKey`, never on the offer, and a live lookup
  never carries one. `/reprice` (library "Add to campaign") re-attaches the current one via `withStoredBrochure`;
  Copy a campaign does the same from `GET /api/brochures/current` (no search). UK → included; European edition →
  attached but unticked; a prior include choice wins. **Campaigns never write to `library_entries`.**
- **Salesperson UTM:** `salespersonTag(createdBy)` → `tracking.utm.utm_term`, applied by `campaignUtm()` to the offer
  links and the footer link. It lives on the link-map destination, so the email HTML (and `diff-reference`) does not
  change.
- **Inbox preview:** derived from the intro unless the campaign carries a preheader (a copied older campaign may).
  The register's Preheader column is empty for new campaigns — the derived text is not stored.
- **Promote = copy, admin-only.** Shared shelves in `config/library-shelves.json` (PCH/BCH latest deals, EVs, and the
  smart "Deals under £300 per month").
- Copy for Outlook copies the campaign **as created**; any offer change (incl. a Library add) drops the created result,
  so the salesperson presses Create again.
- Links inside a preview iframe 404 — expected; only a created campaign has links.
- The seeded default template is a **placeholder, not Emma-approved**.
- A brochure "nothing found" is remembered 7 days (1 day if the official site was never reached); never a failed
  search; nothing across a `FINDER_VERSION` change.
- The site HTML-encodes text in its script block ("Techno &#x2B; Comfort"); decoding happens at lookup and wherever an
  offer reaches the server (`packages/schema/src/text.ts`).
- `brochure/operate.ts` runs inside Firecrawl's browser in ONE scrape with `actions`; it must never press request /
  test-drive / configurator controls or submit anything.
- **Windows:** a long heredoc with backticks and apostrophes can fail in the Bash tool — write a script file. `git
  commit -F` with a very long path fails ("Filename too long") — keep message files on a short path. Office opens
  files from `%TEMP%` in Protected View, which **hangs hidden Word automation** — use a normal folder and a timeout,
  and only ever stop the Word process you started (`/Automation`).
- The four rules (`CLAUDE.md`) are load-bearing: **CAP IDs never stored; three layers no leaks (`render()` is the
  only HTML producer); compliance locked; drafts only.**

## 8. Start

Confirm in a few lines that you have read the docs above; state the git, test and live state as you find them
(`git status`, `git log --oneline -5`, `pnpm test`, `/health`); then ask Matt which of §5 he wants, leading with the
thing only he can do: a test send from the current `main`, made with Keep source formatting. Propose nothing else
until he answers.
