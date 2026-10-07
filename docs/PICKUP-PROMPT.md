# Pickup prompt — DreamLease Offer Mailer

Paste everything below the line into a new Claude Code session opened in `C:\Users\MatthewWilson\email-offer-builder`.
**Updated 7 October 2026 (session 11). Production is v0.7.6 (no processing fee anywhere in the tool; Compose steps
1–3 start from what was used last), deployed by Matt on 7 Oct; 0.7.7 (an Install app button and a bold app icon) is the
next release. Phase 1 (send from the salesperson's own mailbox) is live. No other work is
in flight.** This prompt supersedes all earlier
ones.

Every state claim is marked:
- **[verified 6 Oct]**: checked that day against the repo or the live system;
- **[asserted]**: recorded, not re-checked.

Verify before you act: run the pickup-verify skill.

---

You are resuming the **DreamLease Offer Mailer**, an internal tool. A salesperson builds a branded email of one to six
lease offers from dreamlease.co.uk offer links, then **sends it from their own mailbox via Microsoft 365** after
automatic checks. Each email has a hosted web page and tracked links. It is an FCA-regulated financial-promotions tool,
so compliance matters.

It is **live** at https://marketingtools.dreamelectric.uk, behind Microsoft sign-in. Customer links are on
https://offers.dreamlease.co.uk.

**The build plan of `docs/evolution.md` Phase 1 is done.** The job now is whatever Matt asks next. The open items are
ranked in §4; do not start any of them without his go.

## 0. How to behave with Matt (read this first)

- **Who he is.** Matt is Head of Marketing and the only stakeholder. He is **blunt, direct, and has zero patience for
  waffle, hedging, or process for its own sake.**
  - Give him substance, evidence and decisions, not essays, in plain English.
  - When he has things to do, give ONE ranked list, one action per step, bundled into one command where possible.
- **No new work without his instruction.** "Continue" is not one.
  - Do not start a build step, review, diagnostic, or any new work until he asks.
  - Before a new step, say in one or two lines what it is, what it changes and what it costs, then **wait**.
  - Exception: a quick change he has just asked for (usually from a screenshot). State it, do it, prove it, report.
- **Reliability is the requirement.**
  - Salespeople never test emails: the design is certified once per release.
  - The tool checks every email automatically and refuses to send a faulty one.
  - He rejected a "Send me a test" button.
- **Estimates and simplicity.**
  - He pushes back hard on inflated estimates. Scope the thinnest proper version, and say honestly what it costs.
  - Fewer screens, fewer buttons, plain words.
- **Prove it before claiming it works:** a test run, a live call, a real browser.
  - When he reports a fault, **read the evidence before theorising**.
  - **Never assume an identity or a cause.** On 29 Sept, `emma.airey@` and "another company's Cloudflare" were both
    wrong. Sign-in addresses come from Zero Trust → Team & Resources → Users.
- **Render tests use his REAL campaign and Emma's live template, never the render fixtures** (memory
  `render-tests-use-real-campaign`).
  - On 6 Oct the fixture samples made him think an old template was in use, and he was angry.
  - With his OK, read `/api/campaigns`, `/api/templates` and `/api/brochures/current` read-only in his signed-in Chrome.
  - Render them with a temporary script, then delete it.
  - He checks the result on unspam.email.
- **He is not the Entra/IT administrator; Emma is.**
  - IT gets click-by-click steps checked against Microsoft's current docs (`docs/it-runbook-sign-in.md`).
  - DNS is at **123-Reg**. Never call it GoDaddy to Matt or IT, even though its name servers are GoDaddy's.
- **Windows, PowerShell.** `pnpm` lives in the Claude app's private storage.
  - Prefix every pnpm command you give him with
    `$env:Path = "$env:LOCALAPPDATA\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\npm;$env:Path"; Set-Location "$HOME\email-offer-builder";`
  - In Claude's own Git Bash, the path is
    `/c/Users/MatthewWilson/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/npm`.
- **Multi-agent or workflow runs only when he asks** (`CLAUDE.md`). A session with "ultracode" on counts as asking.
- **Branches, merges and deploys.**
  - Work on a branch with a pull request. CI is `ci.yml` (it skips docs-only changes) and `security.yml` (gitleaks).
  - **Nothing merges to `main` until he says "ship it".** Then merge with `gh pr merge --squash --delete-branch`.
  - **Production deploys are his own click.**
  - Bump `APP_VERSION` (in `apps/api/wrangler.jsonc` vars, not package.json) in every PR that changes what the Worker
    serves. After he deploys, report the live state (`/health`).
- **The block list** (`~/.claude/settings.json`) refuses:
  - deploys, rollback, delete and `wrangler versions deploy`;
  - remote `db:migrate`, and any bare `wrangler d1 migrations apply` or `d1 execute` (even `--local`);
  - `wrangler secret put/delete/bulk`;
  - the Cloudflare connector's D1 query and writes;
  - history-destroying git, `stash` included;
  - edits to `.claude/launch.json` and the settings files;
  - reading secret files (`.dev.vars`, `.env`, logins).

  **Allowed:** `pnpm db:migrate:local`. Bash text that merely *contains* `dev:live`, `run deploy`, `db:migrate `,
  `wrangler secret put` or `d1 execute` is refused too, so put commit messages, PR bodies and patch scripts in files.
  Matt runs blocked commands in PowerShell. For a production D1 read, give him the exact SELECT and ask for the output.
- **Never type or read secrets for him.** He pastes them.
- **Claude in Chrome** (his real Chrome, signed in to Cloudflare and to the tool) is used only with his OK. It is how
  to act in his Cloudflare dashboard, or read the live API as him. The app's built-in browser cannot sign in to
  either.

## 1. Read these, in order

1. `CLAUDE.md`: the four rules, the rendering scope and method, the working agreement, commands.
2. **This file.**
3. `docs/status-2026-10-06.md`: what happened from 30 Sept to 6 Oct, the decisions, the new gotchas, the open list.
4. `docs/architecture.md`, the solution design (current-state, updated 6 Oct). Read these sections:
   - A2, special-offer pricing and `PRICING_VERSION`;
   - A5, the clients and how rendering is assured;
   - B1, the two hosts;
   - B7, the deviations a–f and `ownFileUrl`;
   - B9, the status and the owed list;
   - B12, how to extend;
   - B13, the send.
5. `docs/evolution.md` §5–§7: the phases, Phase 1 as it went, the open questions for Phase 2 (monday.com) and
   Phase 4 (Mautic).
6. When relevant:
   - `docs/it-runbook-sign-in.md` (Parts B–D, Ongoing: secret renewal);
   - `docs/phase1-review-pack.md` (the send's security properties);
   - the header of `packages/render/src/cards.ts`.
7. Memory, `~/.claude/projects/C--Users-MatthewWilson-email-offer-builder/memory/` (index `MEMORY.md`). It holds the
   addresses, the delivery direction, SalSac later, Templates UX parked, render tests with the real campaign, and the
   DKIM/DMARC rollout.

## 2. Repo and live state

| Item | State |
|---|---|
| Git | `main` at `802d7f4` (PR #24, 0.7.6) [verified 7 Oct]; the working tree was clean on 7 Oct (the 5 Oct scratch files `body.txt`, `m.txt`, `u.txt`, `u2.txt` went to the Recycle Bin at Matt's request). This hand-over merged as PR #21. 0.7.7 may have merged since: check `git log` and `gh pr list`. |
| Tests | `pnpm test` **320 pass** (schema 23, render 40, adapters 122, api 135; the web app has no tests: its changes are proven in a real browser) [verified 7 Oct]; `pnpm typecheck` clean; `diff-reference` **172** (more is a regression). Run `diff-reference` from **Git Bash**: under PowerShell its `diff` is missing and it falsely reports "all sections match" [verified 6 Oct]. |
| Production | **v0.7.6**, deployed by Matt on 7 Oct. `/health` on workers.dev and on offers.dreamlease.co.uk: 0.7.6, db ok, images true, firecrawl true; marketingtools.dreamelectric.uk redirects to the Access sign-in [verified 7 Oct]. 0.7.7 (Install app, bold icon) is the next release: check `/health` for what is live. |
| Releases since 29 Sept | 0.6.2 and 0.7.0 (Phase 1) on 30 Sept. On 6 Oct: 0.7.1 (special offers), the Outlook classic fixes and salary sacrifice parked (no bump), 0.7.2 (customer address), 0.7.3 (unknown addresses to the website, robots.txt). On 7 Oct: 0.7.4 (no processing-fee line on the cards, PR #22), 0.7.5 (no processing fee anywhere in the tool, PR #23), 0.7.6 (Compose steps 1–3 start from what was used last, PR #24). Each was merged on "ship it"; all deployed by Matt [verified 7 Oct: git log; 0.7.6 on /health]. Next: 0.7.7, the Install app button and a bold app icon. |
| Sign-in | Access app `marketingtools`, shared **Staff** policy (dreamlease.co.uk and salsac.co.uk), Entra as the identity provider. `ACCESS_AUD` is set: `/api` on a customer host answers 401 [verified 6 Oct]. |
| Send (Phase 1) | Vars `MAIL_TENANT_ID`, `MAIL_CLIENT_ID`, `MAIL_REDIRECT_URI` are in `wrangler.jsonc` [verified 6 Oct]. Secrets `MAIL_CLIENT_SECRET` (expires 30 Sept 2027) and `MAIL_TOKEN_KEY` were set by Matt [asserted]. Real sends exist, e.g. BYD Seal 6 + Alfa Romeo Junior, 30 Sept, `sentVia: m365` [verified 6 Oct via `/api/campaigns`]. Only dreamlease.co.uk addresses may send (`config/mail.json`). |
| Compliance wording | Emma's "Approved Wording - 29/09/2026", version 4, `markupVersion` 2, approved by `emma@dreamlease.co.uk` on 29 Sept 12:42 UTC; blocks for personal, business and salary sacrifice [verified 6 Oct via `/api/templates`]. `MARKUP_VERSION` is 2 [verified 6 Oct]. |
| Customer address | CNAME `offers` → `saas.dreamelectric.uk` at 123-Reg. The Cloudflare for SaaS hostname and certificate are Active (HTTP validation, expires 4 Jan 2027). `PUBLIC_BASE_URL` = `https://offers.dreamlease.co.uk` [verified 6 Oct]. workers.dev stays on for links sent earlier. |
| Data | 36 campaigns in production, most of them tests [verified 6 Oct via `/api/campaigns`]. `RETENTION_CAMPAIGN_DAYS` is unset. Migrations 0000–0004 are applied in production [asserted; 0004 by Matt, 29 Sept]. |
| People | `matt.wilson@dreamlease.co.uk` is the master admin (`config/admins.json`). **`emma@dreamlease.co.uk`** is the only compliance approver (`config/compliance.json`; `COMPLIANCE_EMAILS` can add a deputy) [verified 6 Oct]. |
| Email authentication | SPF `v=spf1 include:spf.protection.outlook.com -all`. **No DKIM** (`selector1` / `selector2`) and **no `_dmarc`** on dreamlease.co.uk or salsac.co.uk [verified 6 Oct, dns.google]. |
| Local tool | `.claude/launch.json` defines three servers [verified 6 Oct]: `api-live` (:8787, production data through `dev:live`), `web` (:5173), and `api-local` (:8788, local storage; serves `/app/` after `pnpm build:web`). |
| Must stay as is | The four MotorComplete Snippets on the `dreamelectric.uk` zone stay **disabled**. There are no `routes` in `apps/api/wrangler.jsonc`. |

## 3. How each part works (source → code → constraint → current value)

| Part | Source of truth | Code | Constraint | Now |
|---|---|---|---|---|
| Offer price | dreamlease.co.uk's `GET /api/carresults/GetOfferDropdownsForCar` | `packages/adapters/src/url/` (`parse-page.ts`, `pricing.ts`, `url-source.ts`, `build-offer.ts`) | A special offer is priced only when the page's `offer-id` is sent as `offerId`. Every offer is stamped `source.pricingVersion`; an older version is re-looked-up (cache, restored draft, Send). The lookup warns when the price ≠ the page's schema.org `lowPrice`. | `PRICING_VERSION` 2. A live sweep of 10 specials matched to the penny on 6 Oct. |
| Email markup | `design/dreamlease-offer-mailer-v5.html` | `packages/render` (`cards.ts`, `render.ts`, `html.ts`, `links.ts`) | `render()` is the only HTML producer. Deviations a–g are recorded in the `cards.ts` header. No processing fee anywhere in the tool (0.7.4, 0.7.5). `diff-reference` = 172. A visible change bumps `MARKUP_VERSION`, and then Emma must re-approve. | `MARKUP_VERSION` 2. Outlook 2016/2019, Gmail, Apple Mail, iPhone and Outlook.com render correctly (unspam.email, 6 Oct). Dark Outlook.com/365/Mac is dark but readable (accept). |
| Compliance | Emma's published template | `apps/api/src/templates.ts`, `config/compliance.json` | Only a compliance approver writes or publishes. The placeholder never sends. | Version 4, approved 29 Sept. Its salary sacrifice block still says "the date shown on each offer". |
| Send | Salesperson's own Microsoft 365 mailbox | `packages/adapters/src/m365/`, `apps/api/src/mail.ts`, `send.ts`, `presend.ts`, `mail-crypto.ts` | Rule 4: the signed-in creator only, after the checks, one customer, once. The address is never stored. | Live since 0.7.0. Copy for Outlook is the backup, behind the same checks. |
| Audiences | — | `apps/web/src/Compose.tsx` | `SALSAC_LIVE = false`, `WHATSAPP_LIVE = false`. | PCH and BCH only. Salary sacrifice and WhatsApp show "coming soon". |
| Customer host | `offers.dreamlease.co.uk` (Cloudflare for SaaS) | `apps/api/src/index.ts` (notFound), `ui.ts` | Customers only ever see the DreamLease domain. An unknown GET goes 302 to www. `robots.txt` is Disallow: /. | Live (0.7.2 / 0.7.3). |
| Images on old address | R2 `offer-mailer-images` | `ownFileUrl` in `links.ts` | Rule 2: content-addressed `vehicles/<sha256>.jpg`, never a CAP ID. | Old workers.dev `/f/vehicles` and `/f/headshots` URLs are re-pointed at render. |
| Brochures | Manufacturer sites via Firecrawl | `packages/adapters/src/brochure/` | `finder-1.4`, cap 25 credits per search. Prove any change with `finder-sweep.mts`. | Unchanged since 21 Sept. Firecrawl account balance unknown. |

## 4. Open items, ranked (start none without Matt's go)

**Before the list:**
- **Ship and deploy 0.7.7** (the Install app button and the bold icon) if `/health` does not say 0.7.7 yet, then confirm it.
- **Emma removes the processing-fee sentence from her compliance wording** (Templates → new version → edit →
   publish; her personal block says "A processing fee may apply…"; check her business and salary sacrifice blocks
   too). It is the only fee mention left in an email, and only a compliance approver can change it (rule 3).

1. **DKIM and DMARC for dreamlease.co.uk.**
   - The instructions are the Claude Doc "DreamLease email: DKIM and DMARC setup",
     https://claude.ai/code/artifact/aad9ff05-374f-4394-8ccb-804e3ff865b4 (private until Matt shares it).
   - Matt sends it to the Microsoft 365 admin and to the 123-Reg login holder.
   - When they say it is done, check the records (`selector1` / `selector2` CNAMEs, `_dmarc` TXT `v=DMARC1; p=none;
     rua=mailto:dmarc_agg@vali.email`) and have Matt send a test to Gmail ("Show original": DKIM and DMARC PASS).
   - Stay at `p=none` for 6–8 weeks. Tighten only when Matt says, and only after the owners of the Mailjet key and
     the old Mautic/SendGrid on `mailer.` are known.
2. **One real end-to-end send from the live tool to unspam.email's test address.** This is the final certification of
   the real route; the renders that proved the 6 Oct fixes were of HTML pasted into unspam, not a send from the live tool. Matt sends; read the renders with him.
3. **Before the first real customer email:**
   - wipe the test campaigns from the promotions register (Matt runs the statement you give him);
   - Emma sets the retention period (`RETENTION_CAMPAIGN_DAYS`).
4. **Roll-out to salespeople:** each one presses Connect Outlook once. Offer a one-page "how to send" if he wants it.
5. **Check the Offer Mailer's Firecrawl balance** in the Firecrawl dashboard. Claude's own connector accounts were
   out of credits on 5 Oct, which says nothing about the tool's key.
6. **Emma:** the salary sacrifice wording mentions "the date shown on each offer". No rush while salary sacrifice is
   parked.
7. **Optional:** the part-time developer's review of Phase 1 (`docs/phase1-review-pack.md`); it was skipped at ship
   [asserted]. Matt to confirm the Workers Paid plan.

**Parked** (only when Matt says):
- Templates screen items 1–4 (memory `templates-ux-parked`);
- SalSac sending and the salary sacrifice audience (memory `salsac-send-later`);
- Phase 2, monday.com (`evolution.md` §5, §7);
- the badge-control decision (`architecture.md` B9).

**Left as is by Matt (6 Oct):**
- the matched-set rule (multi-offer cards show the same even number of spec boxes);
- the "Ns" placeholder in the 0–62 box.

## 5. Gotchas

- **Never put `routes` in `apps/api/wrangler.jsonc`.** It breaks `dev:live`. The Custom Domain and the `offers.` route
  live in the dashboard.
- **Cloudflare for SaaS waits only 7 days for the DNS.** After that the hostname shows "Moved". To fix it: Custom
  Hostnames, then the row's ▶ → Edit → HTTP Validation → Save → Refresh (runbook C8).
- **dreamlease.co.uk refuses Node's fetch from Matt's PC (403).** Live scripts call `curl` through `execFileSync`.
  Run scripts with `packages/render/node_modules/.bin/tsx`: `pnpm --filter … exec tsx` fails.
- **The Chrome extension blocks output that contains query strings.** Strip `?…`, and read in slices of about
  900 characters.
- **The built-in browser cannot screenshot very tall pages:** the image comes back blank. Use unspam's lightbox, or a
  fixed overlay.
- **`hono/csrf` refuses a non-JSON write without `Sec-Fetch-Site: same-origin`.** A test of Send must send an `origin`
  of `http://localhost:5173` (the local bypass guard).
- **The admin and compliance screens** appear only for the exact addresses in `config/admins.json` and
  `config/compliance.json`.
- **Firecrawl:** an offer older than 24 hours is looked up again at Send, which costs up to 1 credit when the direct
  fetch is refused.
- **The four rules in `CLAUDE.md` are load-bearing:**
  1. CAP IDs are never stored;
  2. `render()` is the only HTML producer;
  3. compliance is locked;
  4. a human presses Send.

## 6. Start

1. Run pickup-verify.
2. Confirm in a few lines what you read.
3. State git (`git status`, `gh pr list`), tests and the live state (`/health` on workers.dev and on
   offers.dreamlease.co.uk).
4. Ask Matt what he wants next, offering the top of §4 as your recommendation. Do it only after saying what it is and
   getting his go.
