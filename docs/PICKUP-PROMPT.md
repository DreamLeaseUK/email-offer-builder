# Pickup prompt — DreamLease Offer Mailer

Paste everything below the line into a new Claude Code session opened in `C:\Users\MatthewWilson\email-offer-builder`.

---

You are resuming work on the DreamLease Offer Mailer, an internal tool where a sales rep pastes a dreamlease.co.uk offer URL, assembles a branded HTML email of one to six lease offers, and gets an Outlook draft plus a hosted web page. Read these, in this order, before doing anything:

1. `CLAUDE.md` — the four rules that never bend, the working method for the template, runtime constraints, Cloudflare details, build order.
2. `docs/status-2026-09-14.md` — where the build is, every decision made since the brief, the open issues, and how to work on the template.
3. `docs/offer-mailer-implementation-notes.md` — Matt's notes for the v5 markup reference (`design/dreamlease-offer-mailer-v5.html`), the non-negotiables and the acceptance test.
4. `docs/dreamlease-offer-mailer-brief.md` — the solution design (v1.1). §5 is the shared contract, §8 is the build plan.

Facts you can rely on without re-checking:

- Steps 1 and 2 are done and committed. On 14 Sept the render package was re-translated to the v5 markup reference, deployed, and the six fixture `.eml` files (`packages/render/out/`) were sent to Matt for the acceptance pass in the implementation notes. If his results are not yet in the conversation, ask for them before changing `cards.ts` or `render.ts`.
- Step 3 (URL lookup, image pipeline, cache, brochure harvest) was built, tested and deployed on 14 Sept and then reverted at Matt's request; the work is in commit `fa14c03` (reverted by `d02e818`) and can be restored with `git revert d02e818` if he wants it back. Ask before doing so.
- The Worker is live at https://offer-mailer.matt-wilson-9b8.workers.dev. `pnpm test` (51 tests) and `pnpm typecheck` were clean at handover. Deploy with `pnpm run deploy` (bare `pnpm deploy` is pnpm's own command). Wrangler auth expires; if a deploy fails with an auth error, ask Matt to run the login command in the status doc from his own terminal.
- Matt (Head of Marketing, the only stakeholder you'll talk to) tests emails by opening the `.eml` fixtures in classic Outlook and New Outlook on Windows and forwarding from New Outlook to his phone (Outlook iOS and Gmail iOS). He sends screenshots. He is direct and wants an agile, frictionless build; he has explicitly said "do full diagnostics before churning another version" after a day of single-screenshot fixes.

How to work on the template: `packages/render` reproduces `design/dreamlease-offer-mailer-v5.html` line for line. After any change to `cards.ts` or `render.ts`, run `pnpm --filter @offer-mailer/render exec tsx scripts/diff-reference.ts` and justify any non-data difference in the header of `cards.ts`. If a client shows a fault, build a labelled diagnostic `.eml` with the real card in each candidate construction, collect Matt's results from every client before choosing, then change the reference and the code together. Then `pnpm --filter @offer-mailer/render fixtures`, deploy, and send Matt the `.eml` files with `SendUserFile`.

Things not to do: don't propose red badges (Matt chose orange); don't propose MJML; don't suggest a Claude Code skill for email design (reviewed and declined); don't change the reference's non-negotiables without a diagnostic and Matt's decision.

Next build step once the template passes: step 3 (brief §8.2). Its previous implementation is in `fa14c03`: the offer page carries identity, stats and the image URL, while prices, the initial payment and the badge flags come from the site's own `GET /api/carresults/GetOfferDropdownsForCar` JSON, which also lists the term, mileage and initial-payment options for the chips. The CAP ID appears both in the image URL and as a bare number in that JSON's `rateBookIdentifier`; the CAP ID rule applies to everything you persist.

Start by confirming to Matt, in a few lines, that you've read the documents, what the current git state is, and whether his acceptance results for the v5 build are in.
