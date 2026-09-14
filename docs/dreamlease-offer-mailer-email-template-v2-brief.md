# DreamLease Offer Mailer — email template v2 brief for Claude Design

Author: Matt Wilson, Head of Marketing, DreamLease
Date: 11 September 2026
Updates: `Offer Mailer Email Template.dc.html` (v1) in the "DreamLease Design System" project
Companion: `dreamlease-offer-mailer-brief.md` §5.8 (brochures), §5.9 (CTA), §7.1 (email template)

---

## 1. What this is

v1 is good. The card system, the four layouts, the type scale, the signature and the compliance footer all read as DreamLease and match the brief. Keep all of that. This brief asks for two kinds of change:

- **Catch up with the main brief.** Since v1 was designed, the brief gained an editable CTA per offer (§5.9), a brochure link per offer (§5.8) and a preheader. The template needs all three.
- **Fix what will break in real email clients.** v1 uses a few constructs that look right in the browser preview and fail in Outlook desktop or Gmail. Claude Code builds the MJML from this file, so the file has to show the email-safe construction, not just the look.

Same rules as before: 600px, tables, inline styles, fallback font stack, no web fonts, no background images carrying content, no CSS grid or flex inside the email, every image with alt text, red always `#E30613` at 100%, dark-mode safe.

## 2. Keep unchanged

Header layout, intro block, card proportions and type scale, badge styling on screen, stat tiles look, signature, compliance footer content and styling, the `#EDEDEF` preview surround and meta line, the Arial/Sofia Pro preview toggle.

## 3. Changes

### 3.1 Preheader

Add a hidden preheader immediately inside the outer table, before the header row: `{{ preheader }}` in a `<div>` with `display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all`, followed by the usual run of `&nbsp;&zwnj;` padding so inbox previews don't pull in "View these offers online". Add a `preheader` text prop to the preview controls, default "Three electric options on 36 months, 8,000 miles a year."

### 3.2 CTA system (§5.9)

The button label and target are now per offer. Presets and default labels:

| kind | default label |
|---|---|
| `view_offer` | View this offer |
| `email` | Email me about this |
| `call` | Call me on 01234 567 890 |
| `whatsapp` | WhatsApp me |
| `book` | Book a time to talk |
| `link` | rep supplies the label |

Design requirements:

- The button must hold labels up to 30 characters at every card size without wrapping to two lines in the hero, stack and grid2 cards. In grid3 (compact) a two-line button is acceptable; show it.
- When the kind is anything other than `view_offer`, add a small text link directly beneath the button: "View this offer" in Ignition Red, 13px in hero and stack, 12px in grid2, 11px in grid3. The offer page must always be one click away for compliance reasons.
- One button style for all kinds. Do not add icons inside the button; keep it the green pill.
- Preview controls: add a `cta` enum (`view_offer`, `email`, `call`, `whatsapp`, `book`, `link`) applied to every offer in the preview, plus a `ctaLabel` text prop that overrides the default when non-empty.

### 3.3 Brochure row (§5.8)

Below the button (and below the "View this offer" text link when present), an optional row for the brochure. Two variants:

- **PDF we host:** "Download brochure (PDF)" with a small document glyph.
- **Gated by the manufacturer:** "Request a brochure" with a small external-link glyph.

Style it as a secondary text link, Graphite `#787580` text with the glyph, underlined on hover only in the hosted page. It must not compete with the button. Glyphs are inline `<img>` at 14px, exported as PNG at 2x on transparent, one for each variant, and each needs alt text.

Small print gains one sentence when a brochure is present: "Brochure figures are the manufacturer's and may differ from this offer."

Preview controls: `brochure` enum (`none`, `pdf`, `gated`) applied to all offers.

### 3.4 Bulletproof buttons

v1 puts the padding on the `<a>`. Outlook desktop (Word engine) drops anchor padding, so the pill collapses to text height. Rebuild every button as:

```html
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="background:#31BD51;border-radius:999px;padding:13px 30px;text-align:center;mso-padding-alt:0">
      <a href="…" style="display:block;font-size:16px;line-height:20px;font-weight:600;color:#FFFFFF;text-decoration:none">Label</a>
    </td>
  </tr>
</table>
```

Padding on the cell, anchor `display:block`. Same pattern at all four sizes with the existing padding values moved across. Square corners in Outlook are acceptable.

### 3.5 Image frames

v1 draws each image inside a `<div style="aspect-ratio:4/3">`. Outlook and Gmail don't honour it. Every vehicle image becomes an `<img>` with explicit width and height attributes at its rendered size, `display:block`, `border:0`, on a white cell:

| card | width × height |
|---|---|
| hero (single) | 552 × 414 |
| stack (image left) | 220 × 165 |
| grid2 | 264 × 198 |
| grid3 | 168 × 126 |

Source assets are 1200 × 900 as before. Keep `<image-slot>` in the design file for the preview, but wrap it so the exported markup shows the `<img>` with those attributes and an `alt` of "{{ make }} {{ model }}". The headshot in the signature is a 56 × 56 `<img>` with `border-radius:50%` and alt of the sender's name.

### 3.6 Logo

The header currently imports the vector `DreamLease.Logo`. SVG doesn't render in Gmail or Outlook. Export the light-background logo as a PNG at 2x (340 × 64 for a 170 × 32 render), place it as `<img width="170" height="32" alt="DreamLease">` on the white tile. The vector stays for the hosted page.

### 3.7 Mobile behaviour for grid2 and grid3

v1's mobile preview swaps to the hero layout by script, which a real email can't do. Define what actually happens on a phone:

- Use the **fluid hybrid** pattern: each card is an `inline-block` table with `width:100%;max-width:264px` (grid2) or `max-width:168px` (grid3), wrapped in an MSO conditional ghost table so Outlook desktop keeps the columns. Narrow clients wrap the cards naturally without media queries, which matters because forwarded email in use case 2 can land anywhere.
- Show the result at 375px: grid2 becomes a single column of full-width cards; grid3 becomes a single column too. It is fine for the grid3 card to render wider than its desktop width on a phone, so check the type scale still works when a compact card is 343px wide. If it looks thin, let the compact card adopt the grid2 card's type sizes at full width.
- Keep the mobile preview toggle, but make it render the fluid behaviour rather than switching layout.

### 3.8 Outlook degradations to fix in the markup

- **Badge pills.** `display:inline-block` with padding loses its padding in Outlook. Build each badge as a one-cell table so the pill survives, or accept that Outlook shows them as plain text and show both states in the file. Prefer the table.
- **Stat tiles.** The grey background is on a `<div>` inside the cell. Move background, padding and radius to the `<td>` itself.
- **Negative margins.** Remove `margin:-4px` and `margin:-6px` on the stat tables and small print; adjust the surrounding padding instead.
- **Outer table width.** Add `width="600"` as an attribute alongside the CSS width.
- **Paragraph spacing.** Keep `<p>` with explicit margins as v1 does, but add `mso-line-height-rule:exactly` where a line-height is set.

### 3.9 Validity per card in grid3

v1 merges validity into one "All offers valid until" line under the compact grid. Offers can carry different dates. Put the validity date back on each compact card as an 10px line under the price, and keep a single processing-fee line under the grid.

### 3.10 Placeholder data

Mark the preview script's derived numbers as placeholders in a comment: net salary sacrifice figures (`× 0.68`, `× 0.56`) and business prices (`÷ 1.2`) are illustrative for the design only. In the tool, salsac nets are hand-entered and business prices come from the business offer page. Claude Code must not copy this arithmetic.

## 4. Preview controls after this change

Campaign: `offerCount`, `layout`, `contractType`, `sender`, `cta`, `ctaLabel`, `brochure`, `preheader`.
Preview: `viewport`, `font`.

## 5. Done when

- Every button is cell-padded with a block anchor, at all four sizes.
- Every image is an `<img>` with width, height and alt; no `aspect-ratio` anywhere in the email markup.
- The logo is a PNG.
- The CTA renders all six kinds with a 30-character label at every card size, with the "View this offer" text link appearing for the five non-default kinds.
- The brochure row renders in both variants at every card size, and the small print sentence appears with it.
- A preheader is present and hidden.
- grid2 and grid3 at 375px show single-column cards produced by the fluid hybrid markup, not by a layout switch.
- No `<div>` carries a background colour; no negative margins remain.
- grid3 shows a validity date on each card.

## 6. Still outstanding from the main brief §7

Not part of this update, listed so they aren't forgotten: the hosted page (§7.1, last bullet), the seven tool screens (§7.2) and the one-page "how to send an offer email" guide.
