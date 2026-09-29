# Pickup prompt — DreamLease Offer Mailer

Paste everything below the line into a new Claude Code session opened in `C:\Users\MatthewWilson\email-offer-builder`.
**Updated 29 September 2026 (end of session 10): Phase 1 of `docs/evolution.md` ("Send properly") is BUILT on branch
`feat/phase1-send-m365`, PR #14, not merged, not deployed. It is waiting on IT, Emma and Matt.** It supersedes all
earlier pickup prompts. Every state claim is marked **[verified 29 Sept]** (checked against the repo or the live system
that day) or **[asserted]** (recorded, not re-checked). Verify before you act: run the pickup-verify skill.

---

You are resuming the **DreamLease Offer Mailer**: an internal tool where a salesperson builds a branded HTML email of
one to six lease offers from dreamlease.co.uk offer links, with a hosted web page and tracked links. It is an
FCA-regulated financial-promotions tool (compliance matters). It is **live** at https://marketingtools.dreamelectric.uk
behind Microsoft sign-in (v0.6.1). After the failed demo of 29 Sept (pasting into Outlook classic corrupts the email),
Matt chose to have the tool **send the email itself, from the salesperson's own mailbox, via Microsoft 365**. That is
Phase 1, and it is built; your job is to **see it through to live**: IT's app, the local test send, Matt's deploy,
the certification morning, and any fixes those find.

## 0. How to behave with Matt (read this first)

- Matt is Head of Marketing and the only stakeholder. He is **blunt, direct, and has zero patience for waffle,
  hedging, or process-for-its-own-sake.** Give him substance, evidence and decisions, not essays. Plain English; when he
  has things to do, give ONE ranked list, one action per step, bundled into one command where possible.
- **Do not start a build step, review, diagnostic, or any new work without an explicit instruction.** "Continue" is
  not one. Before a new step, say in one or two lines what it is / changes / costs, then **wait**. Exception: a quick
  change he has just asked for (usually from a screenshot): state it, do it, prove it, report.
- **Reliability is the requirement.** Salespeople never test emails: the design is certified once per release, and the
  tool checks every email automatically and refuses to send a faulty one. He rejected a "Send me a test" button.
- **Estimates:** he pushes back hard on inflated ones. Scope the thinnest proper version; say what it costs honestly.
- **Simplicity:** fewer screens, fewer buttons, plain words.
- **Prove it** before claiming it works (a test run, a live call, a real browser). When he reports a fault, **read the
  evidence before theorising**, and **never assume an identity or a cause** (29 Sept: `emma.airey@` and "another
  company's Cloudflare" were both wrong). Addresses come from Zero Trust → Team & Resources → Users.
- **He is not the Entra/IT administrator.** IT gets click-by-click steps checked against Microsoft's current docs
  (`docs/it-runbook-sign-in.md` Part D is written; Emma is the Entra administrator, and her Word copy is
  `Downloads/DreamLease Offer Mailer - Entra send setup (for Emma).docx` on Matt's PC, sent 29 Sept).
- **Windows, PowerShell.** `pnpm` lives in the Claude app's private storage: prefix every pnpm command you give him with
  `$env:Path = "$env:LOCALAPPDATA\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\npm;$env:Path"; Set-Location "$HOME\email-offer-builder";`
  [verified 29 Sept]. In Claude's own Git Bash the path is
  `/c/Users/MatthewWilson/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/npm`.
- **Multi-agent / workflow runs only when he asks** (`CLAUDE.md`). A session with "ultracode" on counts as asking.
- Work on a branch with a pull request (CI: `ci.yml` (skips docs-only changes), `security.yml` gitleaks); **nothing
  merges to `main` until he says "ship it"**; production deploys are his own click. Bump `APP_VERSION`
  (`apps/api/wrangler.jsonc` vars, not package.json) in every PR that ships; report the live state after a deploy.
- **The block list** (`~/.claude/settings.json`) refuses: deploys, rollback, delete, `wrangler versions deploy`, remote
  `db:migrate`, any bare `wrangler d1 migrations apply` or `d1 execute` (even `--local`), `wrangler secret
  put/delete/bulk`, the Cloudflare connector's D1 query and writes, history-destroying git (including `stash`), edits
  to `.claude/launch.json` and the settings files, and reading secret files (`.dev.vars`, `.env`, logins). **Allowed:**
  `pnpm db:migrate:local`. Any Bash text that merely *contains* `dev:live`, `run deploy`, `db:migrate `, `wrangler
  secret put` or `d1 execute` is refused too: put commit messages, PR bodies and patch scripts in files. Matt runs
  blocked commands in PowerShell.
- **Never type or read secrets for him.** He pastes them.
- **Claude in Chrome** (his real Chrome, signed in to Cloudflare) is how to act in his Cloudflare dashboard when he
  asks. The app's built-in browser cannot sign in to Cloudflare.

## 1. Read these, in order

1. `CLAUDE.md`: the four rules (**rule 4 now describes the Microsoft 365 send as built**), the rendering scope, the
   working agreement, commands.
2. **This file.**
3. `docs/evolution.md` §6: Phase 1, the six decisions taken on 29 Sept, the **dependencies** (Emma first; the
   migration before any send), what was built, IT's part, Matt's part, proof, risk.
4. `docs/architecture.md` **B13** (the send as built), B4 (`mail_connections`), B5, B12.
5. `docs/it-runbook-sign-in.md` **Part D** (IT's Send app, D1–D9) and Ongoing (secret renewal).
6. `docs/phase1-review-pack.md`: the security properties and the tests that prove them (for the part-time developer).
7. `docs/status-2026-09-29.md` §8: session 10 in brief.
8. `docs/offer-mailer-implementation-notes.md` and the header of `packages/render/src/cards.ts`: the v5 design and the
   paste-route deviations a–c that the certification morning re-tests.

## 2. Repo & live state

- **Git [verified 29 Sept]:** `main` at `703b2ab` (PR #13 merged). Branch `feat/phase1-send-m365`, **PR #14 open**
  (Phase 1, v0.7.0). Check `gh pr view 14` and its CI before anything else.
- **Tests on the branch [verified 29 Sept]:** `pnpm test` → **307 pass** (schema 23, render 35, adapters 117, api 132);
  `pnpm typecheck` clean; `diff-reference` **84** (the recorded deviations; more is a regression). Run it from Git
  Bash: under PowerShell the script's `diff` is missing and it falsely reports "all sections match".
- **Production [verified 29 Sept]:** v0.6.1 at https://marketingtools.dreamelectric.uk (Access app `marketingtools`,
  shared **Staff** policy: dreamlease.co.uk and salsac.co.uk). `/health` on workers.dev → 0.6.1, `firecrawl:true`.
  Secrets: `ACCESS_AUD`, `FIRECRAWL_API_KEY`. **Migration `0004_mail_connections` IS applied to production** (Matt, 29 Sept, about 17:00; his terminal showed it applied). Only
  the placeholder compliance template exists [asserted: status 29 Sept §2; Claude cannot read production D1].
  **Keep the four MotorComplete Snippets on the `dreamelectric.uk` zone disabled.**
- **Customer links:** still workers.dev; `offers.dreamlease.co.uk` has no DNS record yet [verified 29 Sept]; IT's
  GoDaddy CNAME `offers` → `saas.dreamelectric.uk` is outstanding. Then a one-line PR switches `PUBLIC_BASE_URL`.
- **People [verified 29 Sept]:** `matt.wilson@dreamlease.co.uk` master admin; **`emma@dreamlease.co.uk`** the only
  compliance approver (`config/compliance.json`; `COMPLIANCE_EMAILS` can add a deputy at runtime). Richard Quilter
  and `adam@salsac.co.uk` appear in Zero Trust Users [asserted].
- **Local tool:** `.claude/launch.json` `api-live` (:8787, production data; `dev:live` passes `--var ACCESS_AUD:` and the
  localhost `MAIL_REDIRECT_URI`), `web` (:5173), `api-local` (:8788, local storage; serves `/app/` after
  `pnpm build:web`). Local D1 has migration 0004.
- **Parked:** Templates screen items 1–4 (memory `templates-ux-parked`); SalSac sending (memory `salsac-send-later`).

## 3. What Phase 1 is (as built)

| Piece | Where | Key facts |
|---|---|---|
| Microsoft client + `m365` output | `packages/adapters/src/m365/` | code + PKCE on the tenant's endpoints; refresh token rotates (always store the new one); `/me` check; `/me/sendMail` never sets `from`; outcomes reconnect / app_credential / throttled / rejected / unavailable / **uncertain** (no clear answer to the send itself) |
| Connect Outlook | `apps/api/src/mail.ts` | `/api/mail/connect` (refuses a cross-site start), `/callback` (state + cookie + Access user must match; `/me` must be the Access user), `/status` (D1 only), `/disconnect`; return address = `MAIL_REDIRECT_URI` config, never the request; daily Cron deletes connections unused 90 days |
| Stored permission | `apps/api/src/mail-crypto.ts`, table `mail_connections` (migration 0004) | AES-GCM with `MAIL_TOKEN_KEY`, bound to the owner's email; unreadable (key changed) → deleted, "connect again" |
| Pre-send checks | `apps/api/src/presend.ts` (pure) | approved by a compliance approver (the placeholder never passes); priced; in date (UK); still on the site (looked up < 24 h, else again, price unchanged); assets in R2 / pages not 404/410; links in the stored map; subject + message; ≤ 90 KB; no CAP ID; recipient valid, not suppressed (Send only). Rules in `config/mail.json` |
| Send | `apps/api/src/send.ts` | creator only, own signature; re-render on the server (`renderForSend`); **reserve** (`claimSend`); a reservation is released only when Microsoft certainly did not get it; `uncertain` stays reserved for good (check Sent Items); `markSent` tried twice, never undoes a send; on the local bypass only a localhost page may send |
| Web | `apps/web/src/Compose.tsx` | step 3 Connect (own window, so the draft survives) / Disconnect; step 6 "Send": customer's email (empty per campaign), Send, plain-words failures; Copy for Outlook below, behind the same checks; editing after Create drops the campaign ("create it again") |
| Settings | `wrangler.jsonc` vars `MAIL_TENANT_ID`, `MAIL_CLIENT_ID` (empty until IT's email), `MAIL_REDIRECT_URI`; secrets `MAIL_CLIENT_SECRET`, `MAIL_TOKEN_KEY` | any missing = the tool offers Copy for Outlook only |

## 4. The job now, in order

1. **Wait for IT (runbook Part D).** When Matt pastes the Application (client) ID and Directory (tenant) ID, put them in
   `apps/api/wrangler.jsonc` (`MAIL_CLIENT_ID`, `MAIL_TENANT_ID`; not secrets) on the PR branch. Note IT's D7 and D8
   answers (Conditional Access) in the status log.
2. **Emma publishes the approved wording** (all three contract types). **Deploy only after she has**: Send and Copy for
   Outlook both refuse the placeholder. Chase through Matt.
3. ~~Matt applies migration 0004 to production~~ **Done 29 Sept** (the table exists; the live 0.6.1 code ignores it).
4. **Local test send:** Matt adds `MAIL_TENANT_ID`, `MAIL_CLIENT_ID`, `MAIL_CLIENT_SECRET` and a test `MAIL_TOKEN_KEY` to
   `apps/api/.dev.vars` himself (see `.dev.vars.example`), starts `api-live` + `web`, connects his Outlook at
   localhost:5173, sends a real campaign (approved wording) to his own test address, checks it arrived and is in his
   Sent Items, then **Disconnects** (so no permission encrypted with the local key stays in production).
5. **Matt sets the production secrets:** the client secret (pasted) and a key generated and piped without showing it,
   e.g. `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b) | pnpm --filter @offer-mailer/api exec wrangler secret put MAIL_TOKEN_KEY`
   (prefix with the PATH line). Verify the piping works on his PowerShell before relying on it.
6. **The part-time developer's review** (`docs/phase1-review-pack.md`, decision 5), then Matt says "ship it", merges and
   deploys (`pnpm run deploy`). Report `/health` (expect 0.7.0).
7. **Certification morning:** the fixed set (one offer; three offers; PCH, BCH, salary sacrifice; with a brochure) sent
   to test mailboxes and opened in Outlook classic, new Outlook / web, Gmail (web and app) and iPhone Mail, with
   screenshots. The main risk: the paste-route deviations meet classic Outlook's Word engine with the `[if mso]` parts
   intact for the first time; also confirm the `<style>` block and `[if mso]` arrive (asserted, not yet seen). Fix in
   the design with the diagnostic `.eml` method, never from one screenshot. A visible design change bumps
   `MARKUP_VERSION`, which makes Emma re-approve the template.
8. Before the first real customer email: wipe the test campaigns from the promotions register (Matt runs the
   statement), Emma sets the retention period, and ideally IT's `offers` CNAME is live (workers.dev links may be
   caught by spam filters).

## 5. Gotchas

- Never put `routes` in `apps/api/wrangler.jsonc` (it breaks `dev:live`).
- `hono/csrf` refuses a non-JSON write without `Sec-Fetch-Site: same-origin`; tests of Send must send an `origin` of
  `http://localhost:5173` (the local bypass guard).
- `.dev.vars` values vs deployed secrets under `wrangler dev --remote`: which wins is unverified. A permission stored
  with one key and read with another is simply "connect again".
- The live tool shows admin/compliance screens only for the exact addresses in `config/admins.json` /
  `config/compliance.json`.
- Firecrawl credits: an offer older than 24 hours is looked up again at Send (up to 1 credit when the direct fetch is
  refused, which it is from Matt's PC). Check the balance before any finder sweep (the period ends 9 Oct).
- The four rules (`CLAUDE.md`) are load-bearing: CAP IDs never stored; `render()` the only HTML producer; compliance
  locked; a human presses Send.

## 6. Start

Run pickup-verify. Confirm in a few lines what you read; state git (`git status`, `gh pr view 14`, its CI), tests and
live state (`/health`). Ask Matt where IT, Emma and the review stand, then do the next step in §4 that is unblocked,
after saying what it is and getting his go.
