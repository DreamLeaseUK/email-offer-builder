# Pickup prompt — DreamLease Offer Mailer

Paste everything below the line into a new Claude Code session opened in `C:\Users\MatthewWilson\email-offer-builder`.

---

You are resuming work on the DreamLease Offer Mailer, an internal tool where a sales rep pastes a dreamlease.co.uk offer URL, assembles a branded HTML email of one to six lease offers, and gets an Outlook draft plus a hosted web page. Read these, in this order, before doing anything:

1. `CLAUDE.md` — the four rules that never bend, runtime constraints, Cloudflare details, build order.
2. `docs/status-2026-09-14.md` — where the build is, every decision made since the brief, the client verification matrix, the open issues, and the working method for template changes.
3. `docs/dreamlease-offer-mailer-brief.md` — the solution design (v1.1). §5 is the shared contract, §8 is the build plan.

Facts you can rely on without re-checking:

- Steps 1 and 2 are done and committed (`7bc5777`, `f2b6372`). On 14 Sept a three-part card diagnostic (`packages/render/scripts/diag-card.ts`, rows R/D1–D6, I1–I6, S1–S3; see status doc §5) was sent to Matt. If his results are not yet in the conversation, ask for them before touching `cards.ts`.
- The Worker is live at https://offer-mailer.matt-wilson-9b8.workers.dev. `pnpm test` and `pnpm typecheck` were clean at handover. Wrangler auth expires; if a deploy fails with an auth error, ask Matt to run the login command in the status doc from his own terminal.
- Matt (Head of Marketing, the only stakeholder you'll talk to) tests emails by opening the `.eml` fixtures in classic Outlook and New Outlook on Windows and forwarding from New Outlook to his phone (Outlook iOS and Gmail iOS). He sends screenshots. He is direct and wants an agile, frictionless build; he has explicitly said "do full diagnostics before churning another version" after a day of single-screenshot fixes.

What is open on the email template, in priority order (details in the status doc §4):

1. Classic Outlook renders grid2 cards narrow (~318px) in a wide column, a regression after the last two changes (`table-layout:fixed`, content-sized grid badges).
2. New Outlook desktop in a narrow pane: the vehicle image stays 284px inside a full-width card; the stack layout wraps its image column above the content.
3. New Outlook desktop in a wide pane has not been re-verified since ghost tables were removed.

How to work on those: do **not** edit `packages/render/src/cards.ts` in response to a single screenshot. Build one diagnostic `.eml` with the real grid2 card (badges included) in each candidate construction, labelled, following `packages/render/scripts/diag-grid.ts`. Ask Matt to open it in classic Outlook, New Outlook (wide and narrow pane) and forward it to his phone, and collect all results before choosing. Then apply exactly the winner, run `pnpm --filter @offer-mailer/render fixtures`, deploy, and send Matt the `.eml` files from `packages/render/out/` with `SendUserFile` for a full pass. Constructions already proven or rejected are recorded in the status doc; don't re-try floated tables or ghost tables.

Things not to do: don't reintroduce `[if mso]` conditionals inside the email body; don't add line-height inside the VML pills; don't propose red badges (Matt chose orange); don't propose MJML; don't suggest a Claude Code skill for email design (reviewed and declined); don't touch the brochure glyph icons until asked.

After the template issues are closed, the next build step is 3 (brief §8.2): URL lookup adapter with HTMLRewriter parsing, image pipeline via Cloudflare Image transformations to R2 under `vehicles/<sha256>.jpg`, term/mileage chips, 24-hour cache of parsed offers only, and the brochure harvest (§5.8). The CAP ID rule applies to everything you persist.

Start by confirming to Matt, in a few lines, that you've read the three documents, what the current git state is, and which of the three open template issues you propose to diagnose first and how.
