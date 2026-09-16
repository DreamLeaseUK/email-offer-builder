# Pickup prompt — DreamLease Offer Mailer

Paste everything below the line into a new Claude Code session opened in `C:\Users\MatthewWilson\email-offer-builder`. **Rewritten 16 September 2026 (end of session 3).** It supersedes all earlier pickup prompts. Read it top to bottom before doing anything.

---

You are resuming the **DreamLease Offer Mailer**: an internal tool where a sales rep pastes a dreamlease.co.uk vehicle URL, assembles a branded HTML email of one to six lease offers, and gets Outlook-ready HTML plus a hosted web page. It is an FCA-regulated financial-promotions tool (compliance matters).

## 0. How to behave with Matt (read this first)

- Matt is Head of Marketing and the only stakeholder. He is **blunt, direct, and has zero patience for waffle, hedging, or process-for-its-own-sake.** He will swear at you when you talk around a problem or stall. Give him substance, evidence, and decisions — not essays.
- **Do not start a build step, review, diagnostic, or any new work without an explicit instruction.** "Continue" is not one. Before a step, say in one or two lines what it is / changes / costs, then act.
- Do **not** hide behind "compliance sign-off needed" as a reason not to build — that specific move made him furious this session. Where a human check genuinely matters, build it *into* the flow (the rep confirms), don't make it a gate.
- **No multi-agent workflows / background runs** unless he asks. Prefer doing the work directly and showing evidence.
- When you claim something works, **prove it** (a live call, a test run, a screenshot). He tests emails in classic Outlook + New Outlook (Windows) and forwards to his phone.
- Report the live system's state plainly after any deploy.

## 1. Read these, in order

1. `CLAUDE.md` — the four rules that never bend, the working method for the email template, the working agreement, runtime constraints, Cloudflare details, build order.
2. **This file.**
3. **`docs/architecture.md` — the authoritative Solution Design & System Architecture (current-state).** The technical map: layers, data model & storage, auth & roles, PII/compliance posture, routing, roadmap. **Read this for the full picture.**
4. `docs/status-2026-09-16.md` — the session-3 build log (what was built, decisions, findings). `status-2026-09-15.md` / `-14.md` are history.
5. **`docs/brochure-finder-brief.md` — the deferred major task** (brochure discovery redesign, for Fable). See §5 below.
6. `docs/dreamlease-offer-mailer-brief.md` — the original product brief / requirements (v1.1); §5 is the shared contract, §8 the build order.
7. `docs/offer-mailer-implementation-notes.md` — the v5 email markup non-negotiables + acceptance test.

## 2. Repo & live state (verified 16 Sept, end of session 3)

- **Git:** `main`, clean tree, **pushed to `origin`** = `https://github.com/DreamLeaseUK/email-offer-builder` (private, DreamLeaseUK org). Auth via Git Credential Manager (stored) — `git push` just works. **HEAD `74e28fc`.** Run `git log --oneline db9e1be..HEAD` for the 12 session-3 commits (secondary links, rep profile + CTA, recipient-PII minimisation, role gate, template admin API + UI, suppression register API + UI, retention Cron, docs). **Working tree clean — nothing uncommitted.**
- **Tests:** `pnpm test` → **154 pass** (schema 18, render 27, adapters 52, api 57). `pnpm typecheck` clean; `apps/web` builds.
- **Live Worker:** https://offer-mailer.matt-wilson-9b8.workers.dev/health → v0.3.0. **Prod NOT redeployed — behind HEAD.** Every `/api` route returns **503 in production until Cloudflare Access is configured (IT dependency)**, so the tool runs via `wrangler dev` + tests, not live `/api`.
- **Firecrawl key:** in `apps/api/.dev.vars` as `FIRECRAWL_API_KEY` (local; `wrangler dev` health shows `firecrawl:true`). `.dev.vars` is git-ignored. Prod secret unconfirmed.
- **Roles for local testing:** `matt.wilson@dreamlease.co.uk` is the configured master admin (`config/admins.json`); with `DEV_USER_EMAIL` set to any other address you're a salesperson (for testing the admin gate).
- **Dev servers** (won't survive the session): `pnpm dev` (Worker on :8787) and `pnpm --filter @offer-mailer/web dev` (Vite; took **:5173** last run). Vite proxies `/api`,`/c`,`/r`,`/f`,`/b`,`/a` → :8787. Vite binds `localhost` (IPv6) — use `http://localhost:PORT`, not `127.0.0.1`.

## 3. What exists (build order, brief §8.2)

| Step | State |
|---|---|
| 1 Scaffold, schema, D1, Worker, Access, deploy | Done, deployed |
| 2 `render()`, four layouts, hosted page | Done, deployed (v5 markup) |
| 3 URL lookup, image pipeline, brochure harvest | Done (harvest works via `wrangler dev` with the key) |
| 4 Web app (Compose/Campaigns/Library/Register/Suppressions/Templates) | **Core screens built, dev-only** (Vite+React, vendored design system). Not yet served from the prod Worker. |
| 5 Graph draft / Copy for Outlook | Copy-for-Outlook done; Graph draft **parked** (needs IT Entra app) |
| 6 Redirects, click logging, stats | Done |
| 7 Template admin, approval, register, suppression | **Done** — template admin + self-approve, promotions register (in-app + CSV), suppression register (in-app + CSV) |
| 8 Stubs + `docs/evolution.md` | Not started (low value) |

## 4. What was built in session 3 (16 Sept) — full detail in `docs/status-2026-09-16.md`

All committed & pushed. Highlights:

- **Rep-facing UI**: signature **secondary contact links**, the offer-button **CTA selector** + editable label, **portrait photo** + saved/editable sender details (persisted per rep).
- **PII plan completed** (items 1–4): recipient PII **not persisted** (stripped at save) and the greeting kept **off the public hosted page**; a daily **retention Cron** (safe by default — campaigns purged only under `RETENTION_CAMPAIGN_DAYS`); the **suppression register** (plain text, auditable, admin-gated removal, CSV).
- **Step 7 completed**: **role gate** (`roles.ts` + `config/admins.json` → admin/salesperson); **template admin** (create/edit drafts, publish = self-approve, approved templates **locked**, retire) — API + a **Templates** tab (admins only); the **Suppressions** tab (all staff).
- **Decisions**: two roles only (approver parked, master admin self-approves); approved templates immutable (new version to edit); suppression list stored **plain text** not hashed ("lowest friction = least perceived risk"); rep contact details are **business data**, not customer PII.
- Earlier session-2 work (audience/salsac, brochure UI, Firecrawl `rawBase64`, interim allowlist fixes) is in `docs/status-2026-09-15.md`. The `rawBase64` download is load-bearing — keep it.

## 5. THE NEXT MAJOR TASK — brochure discovery redesign (for Fable)

**Read `docs/brochure-finder-brief.md` in full.** Summary:

- **Problem:** brochure discovery is gated on a hand-maintained static allowlist of OEM UK domains. It is structurally unmaintainable — OEMs use global domains (kia.com, denza.com/uk) with unpredictable paths, domains move, new brands arrive monthly. Stale entries fail **silently and customer-facing** (dead "Request a brochure" links).
- **Decision:** replace the allowlist gate with **"the machine finds, the rep confirms"** — Firecrawl returns ranked candidate brochures (junk aggregators denylisted), the rep picks the right one, we download via `rawBase64` and host it. The human confirming is simpler *and* a stronger compliance trail. Zero per-brand maintenance.
- **Status: NOT started. Fable (the intended implementer) is unavailable until Thursday.** The brief is written and ready to hand to Fable. Do not start building the redesign yourself unless Matt says so; if he does, the brief is the spec. The brief's §9 has three open questions for Matt (ranking preference, per-rep cache, denylist contents).

## 6. Still owed by others (not buildable here)

- **IT:** Cloudflare Access (unblocks prod `/api`; today it 503s) + a **Cloudflare-served subdomain** — **`mailer.` is already occupied** (resolves to an unrelated Apache host; `offers.` is free; DNS is at GoDaddy), so a free subdomain is needed (proposed `offer-mailer.` / `offers.`); see `status-2026-09-16.md` §7 and the project memory `custom-domain-setup-parked`. Plus the Graph Entra app (for "Create draft in Outlook").
- **Emma:** the real approved compliance wording for the three contract types (PCH/BCH/salary sacrifice) — the templates currently carry placeholders; publish it via the new **Template admin**. Also the **retention period** for `RETENTION_CAMPAIGN_DAYS`.
- **Matt:** confirm the prod Firecrawl secret; Workers Paid plan; the three open questions in the brochure brief.

## 7. Known-good facts & gotchas (so you don't re-derive them)

- Initial-payment calc is correct (`initial-months × monthly`); a "1-month" offer showing `initial == monthly` is config, not a bug.
- The car image renders on **black only in local `wrangler dev`** (the local Images binding ignores the white fill); production renders white.
- Preview links (`/r/<slug>/...`) only resolve for a **created** campaign; clicking a link inside a *preview* iframe 404s ("Link not found.") — expected, not a bug.
- Firecrawl `rawBase64` fetches a PDF's bytes past Akamai (~2 credits); a fresh brochure harvest takes ~15–25s.
- **"View offer" already deep-links with the rep's configured terms** (`offerUrl` = `canonicalOfferUrl(...)`); the live site honours them (verified). No change needed.
- **Template admin needs all three audience blocks** (PCH/BCH/salsac) — `z.record(ContractType, ComplianceBlock)` requires each; the seeded default template is a **placeholder, not Emma-approved**.
- The four rules (CLAUDE.md) are load-bearing: **CAP IDs never stored; three layers no leaks (`render()` is the only HTML producer); compliance locked; drafts only.**

## 8. Start

Confirm in a few lines that you've read the docs above, state the git + test + live state as you find them (`git log`, `pnpm test`, `/health`), and confirm whether Matt wants to (a) wait for Fable on the brochure redesign, (b) do **step 8** stubs / `evolution.md`, (c) prep the **deploy** / custom-domain runbook, or (d) something else. Steps 1–7 and the PII plan are **done**; the tool is feature-complete for a rep's day-to-day pending Emma's wording and IT's Access + subdomain. Propose nothing else until he answers.
