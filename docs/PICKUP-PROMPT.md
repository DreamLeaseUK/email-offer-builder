# Pickup prompt — DreamLease Offer Mailer

Paste everything below the line into a new Claude Code session opened in `C:\Users\MatthewWilson\email-offer-builder`.
**Updated 29 September 2026 (end of session 9): start Phase 1 of `docs/evolution.md`, "Send properly".** It supersedes
all earlier pickup prompts. Every state claim is marked **[verified 29 Sept]** (checked against the repo or the live
system that day) or **[asserted]** (recorded, not re-checked). Verify before you act: run the pickup-verify skill if it
is available.

---

You are resuming the **DreamLease Offer Mailer**: an internal tool where a salesperson builds a branded HTML email of
one to six lease offers from dreamlease.co.uk offer links, with a hosted web page and tracked links. It is an
FCA-regulated financial-promotions tool (compliance matters). It is **live** at https://marketingtools.dreamelectric.uk
behind Microsoft sign-in. **The demo on 29 Sept failed**: most salespeople use Outlook classic, and pasting the email
into it (Copy for Outlook) corrupts it. Matt then chose a new direction; your job is **Phase 1: the tool sends the email
itself, from the salesperson's own mailbox, via Microsoft 365.**

## 0. How to behave with Matt (read this first)

- Matt is Head of Marketing and the only stakeholder. He is **blunt, direct, and has zero patience for waffle,
  hedging, or process-for-its-own-sake.** Give him substance, evidence and decisions, not essays. Plain English; when he
  has things to do, give ONE ranked list, one action per step.
- **Do not start a build step, review, diagnostic, or any new work without an explicit instruction.** "Continue" is
  not one. Before a new step, say in one or two lines what it is / changes / costs, then **wait**. Exception: a quick
  change he has just asked for (usually from a screenshot): state it, do it, prove it, report.
- **Reliability is the requirement.** He rejected a per-email "Send me a test" button ("a stupid idea — this needs to
  work reliably"). Salespeople never test emails: the design is certified once per release, and the tool checks every
  email automatically and refuses to send a faulty one.
- **Estimates:** he pushes back hard on inflated ones ("why the hell is this a two hour build?"). Scope the thinnest
  proper version first; say what it costs honestly.
- **Simplicity:** he called the Library "far too complicated" and it was simplified. Prefer fewer screens, fewer
  buttons, plain words.
- When you claim something works, **prove it** (a live call, a test run, a real browser). When he reports a fault,
  **read the evidence before theorising**, and **never assume an identity or a cause**: on 29 Sept an assumed sign-in
  address (`emma.airey@`) and an assumed cause (another company's Cloudflare) were both wrong. Read Zero Trust →
  Users for addresses; check the zone's own Rules → Snippets / Workers Routes before blaming anyone else.
- **He is not the Entra/IT administrator.** Anything IT does needs click-by-click instructions a non-technical person
  can follow, checked against Microsoft's current docs (runbook Part A is the pattern; Emma did it on 24–25 Sept).
- He is on **Windows, PowerShell**. `pnpm` lives inside the Claude app's private storage, so a normal PowerShell window
  cannot find it: prefix every pnpm command you give him with
  `$env:Path = "$env:LOCALAPPDATA\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\npm;$env:Path"; Set-Location "$HOME\email-offer-builder";`
  [verified 29 Sept].
- **No multi-agent / workflow runs unless he asks** (`CLAUDE.md`), even when a session prefers them.
- Work goes on a branch with a pull request (CI: `ci.yml`, `security.yml`); **nothing merges to `main` until he says
  "ship it"**, and production deploys are his own click. Report the live state after any deploy.
- **A block list stops you:** deploys, `dev:live`, remote `db:migrate`, `wrangler d1 execute` (even `--local`),
  `wrangler secret put`, the Cloudflare connector's D1 query/writes, history-destroying git, and reading secret files
  (`.dev.vars`, `.env`, wrangler login). A Bash command whose text merely *mentions* `dev:live` or `pnpm run deploy`
  can be refused too: put commit messages and PR bodies in files. Matt runs blocked commands in PowerShell.
- **Never type or read secrets for him.** He pastes them (the Entra client secret, the AUD tag, API keys).
- **Claude in Chrome** (his real Chrome, signed in to Cloudflare) is how to act in his Cloudflare dashboard when he
  asks; it may need him to restart the extension. The app's built-in browser cannot sign in to Cloudflare.

## 1. Read these, in order

1. `CLAUDE.md` — the four rules (**rule 4 now describes the decided Microsoft 365 send**), the rendering scope (the
   four email programs from Phase 1), the working agreement, commands.
2. **This file.**
3. **`docs/evolution.md`** — the plan: why it changed, Matt's requirements, the six decisions, the target
   architecture, the four phases, and **§6, Phase 1 in detail** (flow, pre-send checks, code changes, IT's part,
   Matt's part, proof, risk).
4. `docs/status-2026-09-29.md` — what went live and how, the Snippets, PRs #8–#12, gotchas, and §7 the demo.
5. `docs/architecture.md` — what exists today (A5 is the paste route being replaced; B6 sign-in and roles; B12 how to
   extend: add an API route, connect a new outside system).
6. `docs/it-runbook-sign-in.md` — Part A is the model for IT's Part D (the Send app); Parts B–C and the troubleshooting
   section describe the live set-up.
7. `docs/offer-mailer-implementation-notes.md` and the header of `packages/render/src/cards.ts` — the v5 email design
   and the paste-route deviations a–c that certification will re-test.

## 2. Repo & live state

- **Git [verified 29 Sept]:** `main` at `c8bcbe2` (PR #12). **PR #13** (documents: session 9 day 2, `evolution.md`,
  this prompt) may still be open: check `gh pr list`; if open, ask Matt to ship it before building on it.
- **Tests [verified 29 Sept]:** `pnpm test` → **247 pass** (schema 23, render 35, adapters 93, api 96); `pnpm typecheck`
  clean; `diff-reference` **84** (the recorded deviations; more is a regression).
- **Production [verified 29 Sept]:** the tool at https://marketingtools.dreamelectric.uk (Cloudflare Access app
  `marketingtools`, the shared **Staff** policy: dreamlease.co.uk and salsac.co.uk addresses; Entra's "Assignment
  required" decides who reaches it). `/health` on workers.dev → **0.6.1**, `firecrawl:true`; PR #11 and #12 deployed
  (version not bumped — **bump `APP_VERSION` in every PR that ships**). Secrets: `ACCESS_AUD`, `FIRECRAWL_API_KEY`.
  **Keep the four MotorComplete Snippets on the `dreamelectric.uk` zone disabled.**
- **Customer links:** still on workers.dev; waiting for IT's GoDaddy CNAME `offers` → `saas.dreamelectric.uk`, then a
  one-line PR switches `PUBLIC_BASE_URL` to `https://offers.dreamlease.co.uk`.
- **People [verified 29 Sept]:** `matt.wilson@dreamlease.co.uk` master admin; **`emma@dreamlease.co.uk`** the only
  compliance approver (she is to publish the real wording; the salary sacrifice text Matt supplied was written for a
  quotation); `richard@dreamlease.co.uk` and `adam@salsac.co.uk` have signed in.
- **Local tool:** `.claude/launch.json` `api-live` (:8787, production data; `dev:live` passes `--var ACCESS_AUD:`) and
  `web` (:5173); start both with the preview tools ("restart localhost"). `api-local` (:8788) checks the built app.
- **Parked:** Templates screen items 1–4 (memory `templates-ux-parked`), until Matt says.

## 3. The job: Phase 1, "Send properly" (`evolution.md` §6)

Matt has agreed the plan and the decisions; **ask for his "go" before building**, then work in this order:

1. **IT's steps first (runbook Part D).** Click-by-click, for a non-technical Entra administrator, checked against
   Microsoft's current Entra admin center: a second app registration "DreamLease Offer Mailer - Send" (single tenant),
   Web redirect URIs `https://marketingtools.dreamelectric.uk/api/mail/callback` and
   `http://localhost:5173/api/mail/callback`, delegated Graph permissions `Mail.Send`, `offline_access`, `User.Read`,
   `openid`, `email` with **Grant admin consent**, a 12-month client secret (to Matt by phone), the application ID (by
   email). Offer a Word copy, as on 24 Sept.
2. **Build on a branch, one PR:** the `m365` output adapter (`packages/adapters/src/m365/`, Graph `POST /me/sendMail`,
   I/O injected); OAuth connect / callback / status / disconnect and the send route in `apps/api` (in `OPERATIONS`,
   OpenAPI, contract tests); an additive D1 migration for `mail_connections` with the refresh token **encrypted**
   (key as a Worker secret, never logged); the connected account must equal the Access-verified user; the
   **pre-send checks** (approved compliance template — the placeholder has no approver, so it blocks; offers priced
   and valid; offer links not ended; images and brochures answer; recipient valid and not suppressed; subject and
   intro; size limit; no CAP ID); `sentAt` / `sentVia: 'm365'` / `sentBy` on the campaign; the recipient address used
   and not stored; web UI: Connect / Disconnect Outlook (Step 3), recipient and **Send** (Step 6), Copy for Outlook
   kept as a backup; `CLAUDE.md` rule 4 as built; `APP_VERSION` bumped.
3. **Prove it:** tests, typecheck, build, `diff-reference`; then a real send from the local copy once IT's app exists
   (Matt connects his own Outlook; the secrets go in `.dev.vars` by his hand).
4. **Matt's part:** paste the two production secrets (client secret; a generated encryption key — give him a command
   that generates and pipes it without showing it), ship it, deploy.
5. **Certification morning:** the fixed set (one offer; three offers; PCH, BCH, salary sacrifice; with a brochure) sent
   to test mailboxes and checked in Outlook classic, new Outlook / web, Gmail (web and app) and iPhone Mail, with
   screenshots. The main risk: the paste-route deviations (fluid wrapper, inline-block pills, calc() image column)
   meet classic Outlook's Word engine with the `[if mso]` parts intact for the first time. Fix in the design with the
   diagnostic `.eml` method, never from one screenshot.

## 4. Gotchas

- Never put `routes` in `apps/api/wrangler.jsonc` (it breaks `dev:live`); the Custom Domain and routes live in the
  dashboard.
- `hono/csrf` accepts the browser's `Sec-Fetch-Site: same-origin`; a test client without it gets 403 on a form or
  upload. Not a bug.
- The live tool only shows admin/compliance screens for the exact sign-in addresses in `config/admins.json` /
  `config/compliance.json`.
- Firecrawl credits: check the balance before any finder sweep (the period ends 9 Oct).
- The four rules (`CLAUDE.md`) are load-bearing: CAP IDs never stored; `render()` the only HTML producer; compliance
  locked; a human presses Send.

## 5. Start

Confirm in a few lines that you have read the documents above; state the git, test and live state as you find them
(`git status`, `gh pr list`, `git log --oneline -5`, `pnpm test`, `/health`). Then tell Matt, in three lines, what
Phase 1 delivers, what IT must do and what it costs, and ask for **go**. On go, write IT's Part D first.
