# Offer Mailer — implementation notes for Claude Code

> **Status, 21 Sept 2026 — read before relying on the text below (which is kept verbatim).** These notes were
> written for a send that leaves the HTML intact. The real send path is the HTML **pasted into New Outlook**, which
> drops the `<style>` block and the conditional comments, so several of the non-negotiables need qualifying:
> **(1) and (2) ghost tables** are still emitted but do not reach the recipient, and classic Outlook is not the
> current target; **(7) pills** still holds as written (one-cell table, 126 / 100 content widths), but the pill table is now
> `display:inline-block` rather than the reference markup's `align="left"` float (the clearing spacer did not
> survive and the make name broke beside the pill in Gmail); **(8)** is now a hard requirement rather than a safety
> net — the media query never arrives, so the wrapper is fluid (100% up to 600px, not fixed at 600px) and the stack
> card's image column is fluid inline; **(9) forced light mode** lives in the style block and so does not arrive
> either (untested consequence in Outlook mobile dark mode). The tool also sends one offer per row now, so the
> grid2 / grid3 guidance is dormant. The acceptance test below has **not** been run; the current scope is Gmail and
> New Outlook, validated by Matt's own test sends. Details: `architecture.md` A5 and B7, header of `cards.ts`.

Received from Matt Wilson on 14 September 2026 with `dreamlease-offer-mailerv5.html`. This supersedes the constructions chosen during the 14 September client review (see `status-2026-09-14.md` §2 for what changed and why). Reproduced verbatim.

Two files matter:

- `Offer Mailer Email Template v2.dc.html` — the **visual** source of truth. Interactive preview with tweaks for offer count, layout, contract type, sender, CTA kind, brochure variant, preheader, viewport and font. Use it to see what the email should look like in any combination. Do **not** port its markup: it renders through React, so it cannot contain conditional comments.
- `dreamlease-offer-mailer.html` — the **markup** source of truth. Real send-ready email HTML. This is the reference implementation. Match it.

Where they disagree, the HTML file wins.

In this repo: `design/dreamlease-offer-mailer-v5.html` (markup) and `design/offer-mailer-email-template-v2.dc.html` (visual). `packages/render/scripts/diff-reference.ts` diffs the rendered tag structure against the markup file.

## Non-negotiables

These are the constructs that make the email survive Outlook. Changing any of them reintroduces a known bug.

1. **Ghost tables.** Every group of inline-block cards is wrapped in `<!--[if mso]><table…><tr><td width="…" valign="top"><![endif]-->`, with one ghost `<td>` per card. Without them Outlook classic ignores `display:inline-block` and collapses the grid into a single column of full-width cards. Also present inside the stack card (image column / content column) and the hero CTA row (button / brochure link).
2. **Ghost `<td>` count must match card count.** grid2 in rows of two, grid3 in rows of three. Four offers in grid2 = two ghost rows. A mismatch leaves an empty column in Outlook classic only, so it passes browser review.
3. **Buttons: padding on the `<td>`, `display:block` on the anchor,** plus `mso-padding-alt:0`. The Word engine drops anchor padding, which collapses the pill to text height. Rounded corners are lost in Outlook classic — accepted, do not add VML.
4. **Images: explicit `width` and `height` attributes, `display:block`, `border:0`, real `alt`.** No `aspect-ratio` anywhere. Rendered sizes: hero 550×413, stack 218×164, grid2 262×197, grid3 166×125, headshot 56×56. Source assets are 1200×900.
5. **Background colour, padding and radius go on a `<td>`, never a `<div>`.** Outlook ignores them on a div.
6. **No negative margins.** Adjust surrounding padding instead. Spacers are `<td height="n">&nbsp;</td>` with `font-size:0;line-height:0`.
7. **Fixed-width pills.** Badge pills are a one-cell table with the width on the `<td>`. `<td width>` is content-box, so the attribute is the width **minus** horizontal padding: 126px for the hero (12px padding each side of a 150px pill), 100px for stack/grid2. Setting it to the pill's outer width makes pills unequal.
8. **The media query is enhancement only.** Delete it and the email must still stack on a phone — that is what the fluid-hybrid `display:inline-block; width:100%; max-width:Npx` pattern buys. Outlook mobile and non-Google Gmail accounts need that fallback.
9. **Forced light mode.** `color-scheme`/`supported-color-schemes` metas plus the `[data-ogsc]`/`[data-ogsb]` overrides and the `lock-*` classes on every coloured cell. Removing them lets Outlook mobile invert the cards.
10. **Merge tags live in HTML comments** beside sample copy: `<!--{{ offer.model }}-->Seal`. This keeps the file testable in Litmus and substitutable by the build. Do not emit both as visible text — a previous revision did, and the doubled strings forced the 600px wrapper to 759px.

## Per-offer data the template needs

`make`, `model`, `derivative`, image, `badge1`/`badge2`, price (or salsac `net20`/`net40` + gross), `priceLabel`, `specLine`/`specShort`, four stats (label + value), `validity`, `url`, CTA kind + label, brochure variant + href, small print.

- **CTA kinds:** `view_offer`, `email`, `call`, `whatsapp`, `book`, `link`. Defaults: "View this offer", "Email me about this", "Call me on {phone}", "WhatsApp me", "Book a time to talk", rep-supplied. Labels must hold 30 characters. In grid2 the button has **no** `white-space:nowrap` so a long label wraps rather than clips; in grid3 a two-line button is acceptable.
- **Any kind other than `view_offer`** must add a red "View this offer" text link under the button. Compliance requirement — the offer page is always one click away.
- **Brochure:** `none` / `pdf` ("Download brochure (PDF)", document glyph) / `gated` ("Request a brochure", external-link glyph). When present, small print gains "Brochure figures are the manufacturer's and may differ from this offer."
- **Sender fields:** `name`, `title`, `phone`, `email`, `whatsapp`, `bookingUrl`, headshot. The WhatsApp and booking links come from their own fields, **not** derived from the phone number — the mock derives them only so the preview has something to link to.

## Placeholder arithmetic — do not copy

The preview's salary-sacrifice nets (`× 0.68`, `× 0.56`) and business prices (`÷ 1.2`) are illustrative so the layouts have realistic figures. In the tool, salsac net figures are hand-entered and business prices come from the business offer page.

## Preview-only constructs to strip

`<image-slot>` overlays, `position:relative` on image cells, the headshot wrapper `<div>`, the `.dl-root` wrapper, the `#EDEDEF` preview surround and the meta line, the design-system `<link>`/`<script>` tags. None of these belong in a send.

## Acceptance test

Run each layout (single, stack, grid2, grid3) at 1, 2, 3, 4 and 6 offers through Litmus or Email on Acid, in: Outlook 2016/2019/2021 Windows, Outlook 365 Windows, Outlook web, Outlook iOS, Outlook Android, Gmail desktop Chrome, Gmail iOS, Gmail Android, Apple Mail macOS, Apple Mail iOS.

Check specifically:

- Outlook classic: grids keep their columns; buttons are full-height pills; no empty trailing column; no card wider than its cell.
- Outlook classic with images blocked: alt text readable, layout intact.
- Outlook mobile dark mode: cards stay light, prices stay red, button stays green.
- Gmail mobile, Google account and IMAP account: cards stack one per row either way.
- A 30-character CTA label at every card size: wraps, never clips.
- grid3 at 375px: type scale still legible once cards are full width (the query promotes them to the grid2 sizes).
- Forwarded from Outlook to Gmail and back — use case 2 in the main brief.

## Known accepted degradations

Square corners on cards, buttons and pills in Outlook classic. No `box-shadow` anywhere. Sofia Pro falls back to Arial everywhere (no webfonts by design).
