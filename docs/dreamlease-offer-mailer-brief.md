# DreamLease Offer Mailer — build brief for Claude Code and Claude Design

Author: Matt Wilson, Head of Marketing, DreamLease
Date: 11 September 2026
Status: v1.1 brief (11 Sept 2026: first-review fixes folded in, brochures §5.8, CTA §5.9, badge colour). Sections 1–6 are the shared contract and apply to both tools. Section 7 is for Claude Design. Section 8 is for Claude Code. Section 9 lists the assumptions I've made and the things still open.

---

## 1. What we're building and why

I want a simple web tool that lets a DreamLease sales person or account manager put together a branded HTML email containing one or more vehicle lease offers, and get it into their Outlook in a minute or two, without touching any HTML. Marketing is a team of one (me), and today anything like this has to come through me. The tool should take me out of the loop for the everyday case and leave me responsible for the templates, the compliance wording and the design.

Three uses, in priority order:

1. **Cold-lead follow-up.** A prospect showed interest in a deal and went quiet. The rep sends them the offer they were looking at, or a couple of alternatives, as a proper branded email rather than a plain-text reply.
2. **Offer packs for an organisation.** An account manager assembles a set of offers (typically salary sacrifice EVs) and sends it to one contact at an employer, who then circulates it to their staff. This is always one recipient from our side; the fan-out happens inside the employer.
3. **Renewals.** A new project that will live entirely in monday.com. Around 180 days before a lease ends, the renewals team does a triage call, captures what the customer wants next, and later sends tailored offers. In stage one the renewals person will use the tool by hand; later the tool should be opened from a monday.com item and pre-filled from it.

Stage one is manual assembly and delivery through the rep's own Outlook. Two later evolutions must be cheap to add: integration with monday.com (open from an item, read triage fields, write back what was sent), and an AI offer selector that suggests offers from the library based on the triage notes. Neither is in scope now, but the architecture has to leave room for them so we're not refactoring in six months.

Success looks like: reps actually using it every week, engagement stats I can report on (clicks and hosted-page views), and less marketing time per email.

## 2. Users and constraints

Users are DreamLease sales people, account managers and the renewals team. At most 15, realistically a handful. They are not technical. The rule for the UI is that a rep should be able to make an email from a vehicle URL in under two minutes on their first go, with no training beyond a one-page guide.

Hard constraints:

- **Zero or near-zero running cost.** We have Cloudflare (with the dreamlease.co.uk zone), Supabase, Netlify and Surge. Everything in stage one must fit within free tiers. Firecrawl is the one metered service; budget is ~1,500 credits a month and volume will be low for at least a year.
- **FCA.** DreamLease is an FCA-regulated credit broker. Every email is a financial promotion. Emma Airey is the human sign-off. The tool must make it impossible for a rep to send something without the approved wording, and must give Emma a way to approve templates rather than every email.
- **CAP IDs are never stored.** This is an existing rule across all DreamLease tooling. The website's image URLs contain a CAP ID; the tool must not persist those URLs or any CAP ID anywhere (database, logs, R2 keys, filenames). See §5.3 for how the image pipeline handles this.
- **Outlook first.** Reps use New Outlook on Windows (Microsoft 365). Recipients could be on anything, including classic Outlook, Gmail and phones, and use case 2 emails get forwarded on by the employer, which is a second rendering pass. The HTML must be conservative email HTML.
- **Sofia Pro is licensed** and won't render in email anyway. Email templates use the brand's fallback stack. The tool's own UI can use Sofia Pro from the design system.

## 3. What already exists and what to reuse

**The hero builder** (Claude Design export, `website hero offer carousel v2`). A React-in-Babel editor that makes PNG hero slides for the website carousel. Reuse: the offer data shape (model, trim, monthly price, lease type, term, mileage, initial payment line, VAT tag, tags with one "hot" tag, optional badge), the offer form UX, and the offer-library sidebar (add, duplicate, delete, reset). Do not reuse: Babel in the browser, localStorage as the store, base64 images, PNG rasterising. Treat it as a UX reference, not a codebase.

**The DreamLease design system** (`dreamlease-design-system` repo, synced to the Claude Design project "DreamLease Design System"). Tokens v1.1 are aligned to the live site: green CTA `#31BD51`, Ignition Red `#E30613` for prices/links (never tinted), badge orange `#FF8811` (added 11 Sept 2026 for the offer mailer; add to the DS tokens), black headings, Graphite `#787580` body text, borders `#E1E0E4`, panels `#F6F6F7`. Components include `OfferCard`, `Badge`, `Button`, `Alert`, `Stat`, `Header`, `Footer`, `Logo` (official vectors — never edit path data). The tool's UI should be built from these. The email template should be a faithful email-safe translation of `OfferCard` and the brand tokens.

**The website** (Umbraco on the shared MotorComplete platform, behind our Cloudflare zone). Findings from a test fetch on 11 Sept 2026:

- Firecrawl fetches offer pages on the basic proxy with no bot-detection issues. 1 credit for a page, ~5 for a structured JSON extraction.
- Offer pages are fully server-rendered when fetched as full HTML (not "main content only"). Present: make, model, derivative, body style, fuel, transmission, monthly price, VAT status, initial payment, processing fee (£299.99 inc VAT), badges ("Special offer", "In stock", "DreamLease Exclusive!"), headline stats (0–62, bhp, range, battery, warranty), and the site's lease statement ("At the end of the lease, the vehicle must be returned in its original condition…").
- The offer URL encodes the configuration: `/offers/personal/<slug>/?offer=p-12-36-5000-n&initialRental=12&contractLength=36&annualMileage=5000&includeMaintenance=false`. Changing the query parameters returns that configuration's price, so the tool can offer "same car, different term/mileage" without a fresh search.
- Images: `https://images.motorleaseplatform.com/cvd/?isVan=False&capId=<id>&viewPoint=1&format=webp`. Contains the CAP ID. Some special offers use a hand-uploaded PNG on `pricing.motorcomplete.co.uk` instead.
- There is an offer feed of some kind (the one sent to aggregators). Access is not yet confirmed. Design the lookup as an adapter so a feed can replace or sit alongside the scraper.

## 4. Principles for the architecture

I think the whole thing comes down to keeping three layers apart and never letting them leak into each other:

1. **The offer model.** A plain JSON schema for an offer, a campaign (one or more offers plus a message and a recipient context) and a sender. Everything else reads and writes this.
2. **Source adapters** produce offers: manual form, URL lookup (scraper), feed lookup (later), monday.com item (later), AI selector (later). They all return the same `Offer` object.
3. **Output adapters** take a campaign plus a template and produce a deliverable: Outlook draft via Microsoft Graph, "Copy for Outlook" clipboard HTML, hosted web page, Mautic-ready HTML (later), monday.com update (later).

Rendering is a pure function: `render(campaign, template) → { html, text, subject }`. No adapter knows about any other adapter. Adding monday.com is one new source adapter and one new output adapter, not a change to the editor.

## 5. Shared contract

### 5.1 Data model

Written as TypeScript-ish shapes; Claude Code should turn these into Zod schemas and Claude Design should treat them as the fields available on screen.

```ts
type ContractType = 'personal' | 'business' | 'salary_sacrifice';

interface Offer {
  id: string;                      // uuid
  source: { kind: 'manual' | 'url' | 'feed' | 'monday' | 'ai'; ref?: string; fetchedAt?: string };
  vehicle: {
    make: string; model: string; derivative: string;
    bodyStyle?: string; fuelType?: string; transmission?: string;
    stats?: { label: string; value: string }[];      // e.g. "Range" "258 mi" — max 4 shown
  };
  image?: { key: string; url: string; alt: string; width: number; height: number }; // our R2 copy only; absent for a manual offer with no image, render() uses the placeholder
  contractType: ContractType;
  pricing: {
    monthly: number;                // £ per month
    vat: 'inc' | 'ex';              // personal = inc, business = ex
    initialPayment: number;         // £
    initialMonths: number;          // 1 | 3 | 6 | 9 | 12
    termMonths: number;             // 24 | 36 | 48 ...
    annualMileage: number;
    processingFee?: number;         // £ inc VAT, from site, shown in small print
    maintenance: boolean;
    // salary sacrifice only, entered by hand for now:
    salsac?: { net20: number; net40: number; gross?: number; employerName?: string };
  };
  badges: string[];                 // picked from the fixed list in config/badges.json (maintained by me), never free text
  hotBadge?: string;                // one only, from the same list, always shown first; same pill style as badges for now (see §7.1)
  stock?: 'in_stock' | 'factory_order' | 'limited';
  deliveryNote?: string;            // "6–8 weeks"
  offerUrl: string;                 // dreamlease.co.uk page for the offer (UTM added at render)
  cta?: Cta;                        // defaults to { kind: 'view_offer' }; see §5.9
  validUntil: string;               // ISO date, required; defaults to the last day of the current month at lookup; library greys out expired offers, hosted page expires with it
  brochure?: { brochureId: string; include: boolean };   // see §5.8; include = the rep's toggle
  notes?: string;                   // internal, never rendered
  createdBy: string; createdAt: string; updatedAt: string;
}

interface Cta {
  kind: 'view_offer' | 'email' | 'call' | 'whatsapp' | 'book' | 'link';
  label?: string;                   // overrides the kind's default label; max 30 chars
  url?: string;                     // 'link' only; https
  // email/call/whatsapp/book take their target from Sender at render time, so a shared-mailbox
  // campaign automatically points at sales@ and the department number
}

interface Brochure {                 // one current brochure per vehicleKey, shared by every offer for that model
  id: string;
  vehicleKey: string;               // normalised "make/model", e.g. "kia/ev3"
  title: string;                    // "Kia EV3 brochure (UK)"
  kind: 'pdf' | 'gated';            // pdf = we hold a copy; gated = manufacturer's request page, linked directly
  file?: { key: string; url: string; sizeBytes: number; sha256: string };  // our R2 copy, immutable; pdf only
  sourceUrl: string;                // manufacturer UK PDF or page it came from; for gated, the page we link to
  source: 'harvest' | 'manual';
  ukVerified: { by: 'domain' | 'content' | 'user'; note?: string };
  fetchedAt: string; expiresAt: string;   // expiresAt = fetchedAt + 90 days
  status: 'current' | 'superseded';
  createdBy: string;
}

interface RecipientContext {          // optional; the hook for renewals, monday.com and the AI selector
  firstName?: string; lastName?: string; email?: string; company?: string;
  currentVehicle?: string; leaseEndDate?: string;
  requirements?: { budgetMonthly?: number; fuel?: string[]; bodyStyle?: string[]; seats?: number; mileage?: number; notes?: string };
  external?: { system: 'monday'; boardId: string; itemId: string }[];
}

interface Sender {
  kind: 'user' | 'shared';
  displayName: string; email: string; phone?: string; jobTitle?: string;
  whatsapp?: string;                // E.164, e.g. +447700900123; enables the WhatsApp CTA
  bookingUrl?: string;              // Microsoft Bookings personal page; enables the "Book a call" CTA
  mailbox: string;                  // Graph mailbox to draft into (user's own, or sales@/renewals@)
}

interface Campaign {
  id: string;
  name: string;                     // internal label
  useCase: 'follow_up' | 'offer_pack' | 'renewal';
  templateId: string; templateVersion: number;
  subject: string;
  preheader?: string;
  intro: string;                    // rep's personal message, plain text with line breaks
  layout: 'auto' | 'single' | 'stack' | 'grid2' | 'grid3';   // auto: 1 → single, 2 or 4 → grid2, else grid3
  offers: Offer[];                  // 1–6
  recipient?: RecipientContext;
  sender: Sender;
  compliance: { variant: ContractType; approvedWordingVersion: number };
  hostedPage?: { slug: string; url: string; enabled: boolean };
  tracking: { campaignCode: string; utm: Record<string, string> };
  status: 'draft' | 'rendered' | 'sent' | 'archived';
  sentAt?: string; sentVia?: 'graph_draft' | 'clipboard' | 'hosted_only';
  createdBy: string; createdAt: string; updatedAt: string;
}

interface Template {
  id: string; name: string; version: number;
  markupVersion: number;            // generation of packages/render this template was approved against
  complianceBlocks: Record<ContractType, { title: string; paragraphs: string[] }>;   // locked, versioned, Emma-approved
  footer: { optOutLine: string; companyLine: string };
  approvedBy?: string; approvedAt?: string;
  status: 'draft' | 'approved' | 'retired';
}
// Layout is chosen per campaign (Campaign.layout: 'auto' | layout), not per template.
```

### 5.2 Adapter interfaces

```ts
interface OfferSource    { kind: string; lookup(input: unknown): Promise<Offer> }
interface BrochureSource { kind: string; harvest(vehicle: Offer['vehicle']): Promise<Brochure> }
interface OfferOutput    { kind: string; deliver(rendered: Rendered, campaign: Campaign, sender: Sender): Promise<DeliveryResult> }
interface Rendered       { html: string; text: string; subject: string; hostedHtml: string; layout: TemplateLayout; links: Record<string, string> }  // links: linkId → destination for /r/<slug>/<linkId>
```

Stage one implements `OfferSource`: `manual`, `url`. Stage one implements `BrochureSource`: `firecrawl`, `manual`. Stage one implements `OfferOutput`: `graph_draft`, `clipboard`. The hosted page is not an output adapter: every render writes it (see §5.4). Stubs with typed interfaces (no logic) for `feed`, `monday`, `ai`, `mautic`.

### 5.3 Vehicle lookup and the image pipeline

Flow when a rep pastes a dreamlease.co.uk offer URL:

1. Server (Cloudflare Worker) validates the host is `www.dreamlease.co.uk`, normalises the URL, and reads the configuration from the query string.
2. Fetch the page. Try a direct fetch from the Worker first (we control the Cloudflare zone, so a WAF skip rule for the Worker's header is free); fall back to Firecrawl `scrape` with `formats: ["html"]`, `onlyMainContent: false`. Structured extraction runs on our side from the HTML (cheaper and deterministic) rather than Firecrawl's JSON mode; keep JSON mode as an optional fallback. Parse with HTMLRewriter (streaming, cheap on Worker CPU), not a DOM library.
3. Parse into an `Offer`. Extract: title (make/model/derivative), badges, monthly, VAT line, initial payment, processing fee, term, mileage, initial months, the four headline stats, and the image URL for viewPoint 1.
4. Image: fetch the image server-side, resize to 1200px wide (so it's sharp at 600px on retina), convert to JPEG quality ~82 on a white background, store in R2 under `vehicles/<sha256-of-bytes>.jpg`. Persist only our R2 URL. **Strip the source image URL before anything is logged or saved.** If the fetch fails, the rep can upload an image by hand.
5. Offer alternatives: the tool shows term (24/36/48) and mileage (5k/8k/10k/15k) chips; picking one refetches the page with the changed query parameters. Cache the parsed `Offer` (never the HTML) for 24 hours keyed on the normalised URL.
6. Return the `Offer` to the browser for review. The rep can edit anything before adding it to the campaign; badges and hot badge are picked from the fixed list; the image can be swapped.

Strip CAP IDs at the parser boundary: the parser's output type has no field that could hold one, and a unit test asserts no `capId` string survives into any persisted object.

### 5.4 Delivery

**Primary — Outlook draft via Microsoft Graph.** The tool creates a draft in the sender's mailbox (`POST /users/{mailbox}/messages` with `body.contentType = "html"`), sets the recipient if known, and tells the rep "Your draft is in Outlook". The rep opens it in New Outlook, adds a line if they want, and sends. It lands in Sent Items and replies come back normally. Permissions: delegated `Mail.ReadWrite` for the user's own mailbox, `Mail.ReadWrite.Shared` for department mailboxes (sales@, renewals@) the user already has Send As (or Send on Behalf) rights to in Exchange. This is its own Entra app registration, separate from the one Cloudflare Access uses as its identity provider; IT consents to it once. We never send on the rep's behalf in stage one — creating a draft is deliberately the boundary, so a human always presses Send.

**Fallback — Copy for Outlook.** A button that writes `text/html` and `text/plain` to the clipboard with the Clipboard API, plus a download of the `.html` file. For the day Graph is unavailable or IT hasn't consented yet.

**Always — hosted web version.** Every rendered campaign gets a page at `offers.dreamlease.co.uk/c/<slug>` (the Worker serves it from R2) rendering the same offers in the full design system. The email carries "View these offers online" at the top. This is what the employer contact circulates in use case 2, what survives any email client, and where the engagement stats come from. Pages are unlisted (unguessable slug), carry the same compliance block, and expire with the earliest `validUntil` among the campaign's offers. The slug is generated when the campaign is created, so `render()` can embed the hosted URL and stays a pure function; writing the page to R2 is part of every render, not a selectable output. The rendered HTML stays in R2 after the page expires, as the promotions record.

**Later — Mautic and monday.com.** `mautic` output adapter returns the MJML/HTML with Mautic merge tags in place of our personalisation slots. `monday` output adapter writes "sent, date, hosted URL" back to the item.

### 5.5 Compliance

- Each template carries one locked compliance block per contract type (personal, business, salary sacrifice). Reps cannot edit it. It is versioned; a campaign records which version it rendered with.
- I will supply the approved wording. The site's existing lease statement and the DreamLease FCA/broker status line are the starting point; Emma reviews and approves the block in the tool (an "Approve template" action recorded with her name and date).
- A campaign cannot be rendered against a template whose status isn't `approved`.
- Every email shows: contract type wording (inc/ex VAT), initial payment, term, mileage, processing fee, "subject to status", broker status, offer validity date, and the rep's contact details. Salary sacrifice cards show both the 20% and 40% net figures with a line saying they are illustrative and depend on the employer scheme and personal circumstances.
- The rep-authored parts of a promotion are the intro, the subject, the preheader and any CTA label override. They are not locked, so they are recorded: the promotions register carries them verbatim, and the archived rendered HTML is kept for every campaign. Badges are not free text (fixed list, §5.1). Optional, cheap: a warn-only phrase list Emma owns ("guaranteed", "cheapest", "no credit check") that flags the intro before draft creation without blocking it.
- A "Promotions register" export: CSV of campaigns with subject, preheader, intro text, CTA labels, offers, template version, wording version, sender, date, hosted URL and a link to the archived HTML. Emma can pull this any time.
- Unsubscribe: one-to-one business email doesn't need a list unsubscribe, but the hosted page and footer carry a plain "Don't want offers from DreamLease? Reply and tell us" line, and the tool logs a suppression list the rep sees when they enter an email address.

### 5.6 Engagement metrics

No open-tracking pixels; they're unreliable now that Apple and Microsoft prefetch images. Instead:

- Every link in the email goes through `offers.dreamlease.co.uk/r/<campaign>/<link>` (Worker redirect) which logs the click (campaign, link, timestamp, coarse user agent — no IP stored) then redirects to the destination with UTMs (`utm_source=offer_mailer&utm_medium=email&utm_campaign=<campaignCode>&utm_content=<offerId>`) so GA4 sees the channel.
- Hosted page views are logged the same way.
- Link scanners (Microsoft Safe Links, Proofpoint, Mimecast) pre-click every URL in inbound mail, which inflates clicks the same way image prefetch inflates opens. The redirect drops hits from known scanner user agents, stats report unique clicks per link, and the weekly summary says the number is indicative.
- A simple stats view in the tool per campaign and per rep: sent, clicks, hosted views, first and last activity. A weekly summary I can pull into the marketing report.

### 5.7 Hosting, auth, storage

- **Cloudflare Workers with static assets** for the front end and the API (lookup, render, redirects, hosted pages) in one deploy; Cloudflare steers new projects here rather than Pages. **Workers Paid plan** (about £4 a month): the free plan caps CPU at 10 ms per request, which rules out compiling MJML, resizing images or DOM-parsing an offer page inside the Worker; Paid lifts it to 30 s. This is the one line item above zero (confirmed 11 Sept 2026). Even so, the request path must not compile MJML, resize images in wasm or DOM-parse HTML; see §8.1. **R2** for images, brochures and rendered HTML; **D1** for campaigns, offers, templates, clicks (SQLite, free tier is far beyond our volume). Supabase is acceptable instead of D1 if Claude Code judges the relational tooling worth it; pick one and don't split storage.
- **Cloudflare Access** in front of the tool, using Microsoft Entra ID (our M365 tenant) as the identity provider. Free for up to 50 users. The Access JWT gives the Worker the user's email; that is the `createdBy`.
- **Microsoft Graph** via a second Entra app registration (the first is Access's identity provider) with MSAL in the browser (auth code + PKCE), delegated permissions only. Tokens stay in the browser; the Worker never holds mail tokens.
- Secrets (Firecrawl key, Entra client id) in Worker secrets. No secrets in the front end except the public Entra client id.
- Domain: `offers.dreamlease.co.uk` for hosted pages and redirects; `mailer.dreamlease.co.uk` (behind Access) for the tool. Both in our existing zone.
- Surge and Netlify: not used. One platform.

### 5.8 Brochures

Each offer in the editor has an "Include brochure" toggle. When it's on, the email's offer card and the hosted page carry a "Download brochure (PDF)" link to our stored copy of the manufacturer's UK brochure for that model. Brochures are per model, not per offer: one current `Brochure` per `vehicleKey`, shared by every offer for that model, so a second rep sending the same car next week pays no crawl.

Flow when the rep switches the toggle on:

1. Look up the current `Brochure` for the offer's `vehicleKey`. If one exists and `expiresAt` is in the future, attach it. No crawl, no credits.
2. If there is none, or it has expired, run a harvest. The old copy stays served and stays on every campaign that already used it; it is marked `superseded` only once a new copy verifies. If the harvest fails, keep the old one and tell the rep "This brochure is over 3 months old".
3. Harvest (the `firecrawl` `BrochureSource`), cheapest step first, stop as soon as a PDF is found:
   - Firecrawl `search` for `<make> <model> brochure pdf`, location United Kingdom. Keep only results whose host is on the manufacturer UK domain allowlist (`config/manufacturer-uk-domains.json` in the repo, maintained by me: e.g. `kia.co.uk`, `bmw.co.uk`, `tesla.com/en_gb`, `byd.com/uk`). Prefer a direct `.pdf` result.
   - If the best result is a brochure page rather than a PDF, `scrape` it and take the first PDF link.
   - If nothing, `map` the manufacturer's UK domain with search `brochure`, then scrape as above.
   - If the brochure page is on an allowlisted UK host but exposes no PDF (a "request a brochure" form), record it as `kind: 'gated'` with `sourceUrl` set to that page. Gated is a successful harvest, not a failure; it expires and re-checks on the same 90-day cycle, so a manufacturer that later opens up its PDF gets picked up.
   - Hard cap of ~15 credits per harvest. Past that, show "Not found — upload a PDF or paste a link".
4. For `pdf`: download the PDF directly from the Worker (free, no Firecrawl). Require `application/pdf`, cap at 40 MB, store in R2 under the immutable key `brochures/<sha256>.pdf`. Persist the manufacturer `sourceUrl` (no CAP IDs are involved anywhere in this pipeline).
5. UK verification. The domain allowlist is the primary guarantee: a brochure is only auto-attached if it came from an allowlisted UK host (`ukVerified.by = 'domain'`). As a secondary check when cheap, have Firecrawl parse the first two pages of the PDF and require `£` or "OTR" and no `€`; record `'content'` if it passes. The rep always sees "UK verified via kia.co.uk" and the source link, so a human can eyeball it. A brochure found only off the allowlist is never auto-attached; the rep can confirm it by hand and the record says `'user'`.
6. Expiry is 90 days from `fetchedAt`. Re-harvest is lazy: it's triggered by the next "Include brochure" after expiry, never by a schedule, so credits are only spent on models people are actually sending.
7. Manual path: upload a PDF or paste a URL (a PDF URL becomes `pdf`, a page URL becomes `gated`). Same `Brochure` record with `source: 'manual'`, `ukVerified.by: 'user'`.
8. Delivery is a link, not an attachment. Both kinds go through `offers.dreamlease.co.uk/b/<brochureId>` and the click redirect, so they're tracked like every other link. For `pdf` the card says "Download brochure (PDF)" and the redirect serves our R2 copy; for `gated` it says "Request a brochure" and the redirect sends the recipient to the manufacturer's page. The email stays small either way, and use case 2 forwarding isn't carrying 20 MB. "Attach PDF to the draft" is an opt-in shown only when the file is under 3 MB (Graph's single-call attachment limit; larger files need an upload session, which stays out of stage one).
9. Compliance: the card small print gains "Brochure figures are the manufacturer's and may differ from this offer." Emma approves that line with the template block.

Storage note: R2's free tier is 10 GB and brochures run 5–30 MB each, so a few hundred models fills it over a couple of years. Beyond that R2 is about £0.01 per GB-month, which stays within "near-zero". Superseded files referenced by a sent campaign are never deleted; superseded files nothing references can be cleaned up.

### 5.9 Offer CTA

The card's button defaults to "View this offer" pointing at `offerUrl`, but the rep can change it per offer, because the next step they want is often a conversation rather than a click-through. Presets, with default labels:

| kind | default label | target at render | tracked |
|---|---|---|---|
| `view_offer` | View this offer | `offerUrl` with UTMs | yes |
| `email` | Email me about this | `mailto:<sender.email>?subject=<vehicle>` | no |
| `call` | Call me on 01234 567890 | `tel:<sender.phone>` | no |
| `whatsapp` | WhatsApp me | `https://wa.me/<sender.whatsapp>?text=Hi, I'm interested in the <vehicle> offer` | yes |
| `book` | Book a time to talk | `sender.bookingUrl` (Microsoft Bookings, already in M365) | yes |
| `link` | (required) | any `https` URL the rep enters | yes |

Rules:

- The label is short free text (30 chars) so "Call me" can become "Call Sarah". It's recorded in the promotions register with the intro, as it's rep-authored copy in a financial promotion.
- Targets for `email`, `call`, `whatsapp` and `book` come from the campaign's `Sender` at render, not from the offer, so switching the sender to sales@ repoints every CTA. A preset is only offered when the sender has the field it needs (no WhatsApp number, no WhatsApp CTA).
- `mailto:` and `tel:` links go direct and are not tracked. Redirecting to non-http schemes is unreliable across email clients and the click is the phone ringing anyway. The other kinds go through `/r/` as normal.
- When the CTA isn't `view_offer`, the card keeps a small "View this offer" text link under the button, so the offer page is always one click away and the compliance footer's reference to the full offer still holds.
- Compose has "Apply to all offers" next to the CTA picker; the common case is one CTA for the whole email.
- Salary sacrifice packs (use case 2) default to `view_offer` regardless, since the person clicking is an employee, not the rep's contact.

## 6. Stage one scope

In scope: campaign library (mine and my team's), offer library with search and expiry, compose screen (URL lookup, manual entry, edit, reorder, layout choice, intro message, subject, sender picker, recipient), brochure harvest with 90-day expiry and manual upload (§5.8), live preview (desktop and mobile widths), Outlook draft via Graph, Copy for Outlook, hosted page, click tracking and campaign stats, template admin (me) and template approval (Emma), promotions register export, suppression list.

Out of scope for stage one (interfaces stubbed, no logic): feed lookup, monday.com in either direction, AI offer selector, Mautic export, bulk sending of any kind, image editing beyond swap/upload, A/B testing.

---

## 7. For Claude Design

Please work in the "DreamLease Design System" project so the tokens and components are the ones already there. Two things to design.

### 7.1 The email template (the important one)

Design this as a system of email components, not a single page, because the same pieces get assembled in four layouts. Fixed 600px wide, single column on mobile, tables under the hood (Claude Code will translate into MJML; you design the look). Please design it to look right in the fallback font stack (`Arial, 'Helvetica Neue', Helvetica, sans-serif`) since Sofia Pro won't load in email; if you show a Sofia Pro version, show the Arial version beside it.

Components:

- **Header**: logo (light-background version, official vectors), optional "View these offers online" link right-aligned above it in small text.
- **Intro block**: sender's message, plain paragraphs, generous line height, Graphite body colour. Optional greeting line using the recipient's first name.
- **Offer card** — the core piece. Variants: personal (inc VAT), business (ex VAT), salary sacrifice (two net figures, 20% and 40%, with the illustrative note). Elements: image (4:3, white background, 1200×900 source), badges as fixed-width orange pills (`#FF8811`, white bold text, hot badge first, then up to two more; fixed widths per card size so the row looks balanced, a distinct treatment for the hot badge is deferred), make (eyebrow), model (heading), derivative (subheading), red price with "per month inc VAT", spec line (term · mileage · initial payment), up to four headline stats as small tiles (range, 0–62, battery, warranty — or MPG/CO2 for ICE), green pill CTA (default "View this offer"; the label is rep-editable and the action can be email, call, WhatsApp, book a call or a custom link per §5.9, so design the button for labels up to 30 chars and add a small "View this offer" text link beneath it for the non-default cases), an optional secondary text link under it ("Download brochure (PDF)" with a small PDF glyph, or "Request a brochure" with an external-link glyph when the manufacturer gates it, only when the offer includes one), and a small-print line (processing fee, validity date, brochure disclaimer when a brochure is included). Design the card at three sizes: full width (single offer, image on top or image left), half width (two-up grid), and a compact stacked row for three or more.
- **Layouts**: `single` (one hero offer), `stack` (2–4 full-width cards), `grid2` (two-up, wraps to one column on mobile), `grid3` (three compact cards, stacks on mobile).
- **Rep signature**: name, job title, direct phone, email, small headshot optional. Department variant with no headshot.
- **Compliance footer**: locked block on `#F6F6F7`, 12px, Graphite; contract-type wording, broker status, FCA line, validity, the "don't want offers" line, company address. Must look like part of the brand, not a legal afterthought.
- **Hosted page**: the same campaign rendered in the full design system at desktop width, with the offer cards as proper `OfferCard`s, the intro, the signature and the same compliance block. This is what an employer will circulate, so it should feel like a DreamLease page rather than an email on a web page.

Constraints Claude Code will hold you to: no background images carrying content, no web fonts, no CSS grid/flex in the email (fine on the hosted page), every image with alt text, buttons as bulletproof table buttons, dark-mode safe (logo on white tile, no pure-black text on transparent). Red is always `#E30613` at 100%; badge orange is always `#FF8811` at 100%.

### 7.2 The tool's screens

Use the `dl-*` components. Aim for the feel of a simple internal app, not a marketing site. Screens:

1. **Campaigns** — list of mine / team, status, sent date, clicks; "New campaign" button.
2. **Compose** — left: campaign details (name, use case, subject, preheader, intro, sender picker, recipient fields); centre: the offers in this campaign as cards with drag reorder and a layout picker, each card carrying an "Include brochure" toggle with these states (stored: title, "UK verified via kia.co.uk", fetched date, and a "PDF" or "Request page" tag; searching: skeleton; found: same as stored; not found: "Upload PDF" and "Paste link" actions, plus an "over 3 months old" warning state) and a CTA picker (preset dropdown, editable label, URL field for custom link, "Apply to all offers"; presets the sender can't support are shown disabled with the reason); right: live preview with desktop/mobile toggle. A prominent "Add offer" that opens the lookup.
3. **Add offer** (modal) — a single URL field with "Fetch", showing a skeleton then the parsed offer for review; term and mileage chips to switch configuration; "Enter manually" and "From library" tabs.
4. **Offer library** — searchable grid of saved offers with expiry state, edit, duplicate, "add to campaign".
5. **Send** — three clear actions: "Create draft in Outlook" (primary), "Copy for Outlook", "Copy hosted link"; confirmation state with a link that opens Outlook.
6. **Stats** — per campaign: sent, clicks by link, hosted views, timeline.
7. **Templates** (admin) — list with version and approval status; a template detail page with the compliance blocks and an "Approve" action for Emma.

Please also produce a one-page "how to send an offer email" guide layout for the sales team (screenshots to be dropped in later).

---

## 8. For Claude Code

### 8.1 Stack

- Monorepo, pnpm workspaces: `apps/web` (Vite + React + TypeScript, design system components imported from the DS repo as a workspace package), `apps/api` (Cloudflare Worker, Hono), `packages/schema` (Zod schemas from §5.1, shared), `packages/render` (MJML templates + `render()`), `packages/adapters` (source and output adapters with the interfaces in §5.2).
- No MJML (decided 14 Sept 2026). The v4 design file is already hand-built email-safe table HTML, so `packages/render` reproduces it as TypeScript template functions with the Outlook ghost tables added, rather than re-deriving it through MJML. `MARKUP_VERSION` is bumped when the markup changes in a way Emma should see; a `Template` pins the `markupVersion` it was approved against, and `render()` refuses a mismatch.
- D1 via Drizzle, migrations in repo. R2 bindings for `images`, `hosted` and `brochures`.
- Image processing via Cloudflare Image transformations (5,000 free per month, well above our volume) through the Images binding or `cf.image` fetch options; the resized JPEG is then written to R2. No wasm resizing in the Worker.
- Auth: Cloudflare Access JWT verified in the Worker middleware; MSAL.js in the browser for Graph.
- Tests: Vitest for schema, parser (fixture HTML from real offer pages, sanitised of CAP IDs), render output (snapshot HTML, plus a test that runs the HTML through an email-HTML linter for unsupported CSS), CAP ID leak test, redirect logging, brochure harvest (mocked Firecrawl responses: allowlist filtering rejects a `.de` PDF, a UK request page with no PDF yields a `gated` record, expiry triggers re-harvest, a failed re-harvest keeps the old copy, a superseded file stays served).
- `CLAUDE.md` at the root capturing the layer rule (§4), the CAP ID rule, the compliance-lock rule and the adapter interfaces, so future sessions don't drift.

### 8.2 Build order

1. Schemas, D1 migrations, Worker skeleton with Access middleware, health route. Deploy to Cloudflare so we have a URL from day one.
2. `render()` with one template and the four layouts, fed by fixture campaigns; hosted page route. Get the HTML into a real New Outlook draft by hand and iterate until it renders correctly in New Outlook, classic Outlook (Word engine), Gmail web, Outlook iOS and Apple Mail. Test the everyday path, not just receipt: open the draft, type a line, send from New Outlook and from classic Outlook, and check what arrives. Do this before building the editor — the template is the risk.
3. URL lookup adapter: Worker fetch with Firecrawl fallback, parser with fixtures, image pipeline to R2, config-switch by query parameters, cache. Then the brochure harvest adapter (§5.8): search, allowlist, download to R2, expiry, manual upload, `/b/<id>` route.
4. Web app: campaigns, compose, add-offer modal, library, preview.
5. Graph draft adapter and Copy-for-Outlook; sender picker with shared mailboxes.
6. Redirect Worker, click logging, stats screen.
7. Template admin, approval flow, promotions register CSV, suppression list.
8. Stubs and interface docs for feed, monday, ai, mautic. A short `docs/evolution.md` describing exactly what each later adapter needs to implement.

Ship 1–3 as a working "paste a URL, get a hosted page and an Outlook draft" vertical slice before polishing anything.

### 8.3 Acceptance tests (stage one done when all pass)

- A rep with no training makes a two-offer email from two dreamlease.co.uk URLs and has a draft in Outlook in under two minutes.
- The same email renders acceptably in New Outlook, classic Outlook 2019/365 desktop, Gmail web, Outlook iOS, Apple Mail iOS; a draft opened, edited and sent from New Outlook and from classic Outlook arrives intact; forwarding from New Outlook to Gmail keeps the layout.
- No CAP ID exists anywhere in D1, R2 keys, logs or rendered HTML (automated grep in CI over a full lookup and render), and no raw scraped HTML is persisted anywhere.
- A template that is not `approved` cannot be rendered or drafted; the compliance block cannot be edited from the compose screen.
- Clicking a link in a sent email records a click and lands on the offer page with the correct UTMs.
- A hosted page opens for someone with no login; the tool does not open for someone outside the tenant.
- Changing the term chip on a fetched offer updates the price without a new URL being entered.
- Changing an offer's CTA to "Book a time to talk" renders a button pointing at the sender's Bookings page through the click redirect, keeps a "View this offer" text link on the card, and switching the sender to sales@ repoints an email CTA to sales@ without the rep touching the offer.
- Switching "Include brochure" on for a fetched offer attaches a brochure from an allowlisted UK manufacturer host and the card shows the download link. Switching it on for the same model a week later uses the stored copy and spends no Firecrawl credits. With `fetchedAt` set 91 days back, the next use triggers a re-harvest, and if that harvest is mocked to fail the old brochure is still attached with the "over 3 months old" warning.
- Total monthly cost at expected volume: the Workers Paid plan (about £4) plus Firecrawl credits, nothing else, and Firecrawl usage under 300 credits/month at 100 lookups (cache hits excluded).

### 8.4 Things not to do

- Don't put rendering logic in React components; `render()` is the only place HTML is produced.
- Don't let any adapter import another adapter.
- Don't store source image URLs, CAP IDs, or raw scraped HTML at all; the 24-hour lookup cache holds parsed `Offer` objects only.
- Don't compile MJML, resize images in wasm, or DOM-parse HTML inside a Worker request. Build-time compile, Image transformations, HTMLRewriter.
- Don't send email from the Worker. Drafts only in stage one.
- Don't add Supabase and D1 both. One store.
- Don't reach for Netlify or Surge; everything on Cloudflare.

---

## 9a. As built (14 September 2026)

> **Read with care (note added 21 Sept 2026):** four of the bullets below record the MORNING of 14 Sept and were
> superseded that same afternoon by the v5 reference, and one more on 21 Sept. As built today: the email is
> **600px** wide (fluid up to 600), not 640; the body **does** carry `[if mso]` ghost tables (around each card row,
> inside the stack card, in the hero CTA row) and the cards are inline-block **tables**, not divs; there is **no
> VML** (square corners in classic Outlook are accepted; `diag-vml.ts` is a leftover script); in the **hero** card
> the brochure link sits **beside** the button, under it only on the stack and grid cards; and auto layout is one
> offer per row (the 21 Sept entry below). The bullets are kept as the record of what was tried.

Where the implementation has departed from this brief, and why. `docs/status-2026-09-14.md` carries the full log and the client verification matrix; CLAUDE.md carries the rules.

- **Email width 640px, not 600.** Fluid container up to 640 with the standard Outlook 640 ghost wrapper. The first Outlook review found 600 small in the reading pane.
- **Layout belongs to the campaign, not the template** (`Campaign.layout`). Auto picks single, grid2, stack, grid2 for 1, 2, 3, 4+ offers. grid3 is explicit only.
- **No MJML; no `[if mso]` ghost tables inside the body.** Classic Outlook unwraps conditional comments when it sends or forwards, so a ghost grid reached phones as two fixed columns squeezed to fit. Grids are inline-block divs that Outlook desktop stacks one per row; phones stack natively.
- **Rounded buttons and badges in classic Outlook use VML** in a construction chosen by side-by-side diagnostic (`packages/render/scripts/diag-vml.ts`, variant V4).
- **Brochure link sits under the button** on every card size, not beside it in the hero card.
- **Hosted page is the email markup in a page wrapper** until the design-system hosted page from §7.1 is delivered.
- **Cloudflare Workers Paid** is confirmed but not yet switched on; free plan is sufficient until build step 3.
- **Open template issues** at handover: classic Outlook grid cards render narrow after the last changes; New Outlook desktop in a narrow pane keeps the vehicle image at its design width inside a full-width card and wraps the stack layout's image column above the content. Method for resolving them is in the status doc §5.
- **Lookup (step 3) reads two things, not one.** §3's finding that offer pages are fully server-rendered holds for identity, stats, fees and defaults, but not for prices or badges: those come from the page's own JSON endpoint (`/api/carresults/GetOfferDropdownsForCar`), which also lists the term, mileage and initial-payment options used for the chips. Initial payment is initial months × monthly, as the site computes it. The lookup cache stores the parsed result (offer plus options), never HTML. Stored files are served from `/f/vehicles/<sha>.jpg` and `/f/brochures/<sha>.pdf`; brochure links are `/b/<id>` as specified.

### As built — 15 September 2026 (current state in `docs/status-2026-09-15.md`)

- **Campaign persistence and the working loop.** Campaigns are stored in D1 (a validated `Campaign` snapshot plus the `render()` link map, `campaigns.links` column). `POST /api/campaigns` assembles → renders → writes the hosted page → stores; `GET /api/campaigns`, `/:id`. `POST /api/campaigns/preview` renders a draft without persisting (drives the live preview), and create returns the rendered `html`/`text` for Copy-for-Outlook. The `/r/:slug/:link` redirect resolves against the stored link map and logs a click; hosted-page views are logged too; link scanners are classified and excluded from stats (`GET /api/campaigns/:id/stats`, with last-click and last-view). So the loop from §5.4/§5.6 is closed end to end.
- **The tool UI (step 4).** `apps/web` is a Vite + React app built from the DreamLease design system, which is **vendored into the monorepo as `packages/design-system`** (the `dl-*` components, tokens, Sofia Pro, stylesheet — consumed as source). Screens: Compose (URL lookup, term/mileage/initial chips that re-price in place, live preview, create, Copy-for-Outlook, Save-to-library), Campaigns (list + stats), Library (`POST`/`GET`/`DELETE /api/offers/library`), Register.
- **URL lookup accepts any vehicle page.** Not just `/offers/<type>/<slug>/` but any dreamlease.co.uk path carrying a `personal`/`business` segment (e.g. `/<make>-car-lease-deals/<type>/<model>/<derivative>/`); identity comes from the page, so the path shape does not matter.
- **Delivery.** Copy-for-Outlook (clipboard `text/html`+`text/plain`) is built and needs no IT. The Graph "Create draft in Outlook" is **parked** pending IT's Entra app — the compliance shape (delegated `Mail.ReadWrite`, browser-held tokens, drafts-only, app assigned to sales users) is agreed; see the status doc §4.
- **Compliance record.** The promotions register (§5.5) is a live in-app master list plus CSV (`GET /api/register`, `/api/register.csv`). **Auto-append into DreamLease's existing Google Sheets financial-promotions register is a wanted future integration**, deferred pending the sheet's column layout, a Google service account, and a log-trigger decision. Template admin + Emma approval and the suppression list were still to build on 15 Sept — **both were built on 16 Sept** (see the 16 Sept entry below); the seeded default template's wording is still a placeholder, not yet Emma-approved.

### As built — 16 September 2026

- **Template admin and approval** (§5.5, §7.2 screen 7): master-admin-only create / edit drafts, publish, retire;
  approved templates are locked (a change is a new version). **Departure from §5.5:** there is no separate approver
  — the approver role is parked and the master admin who authors a template also approves it (Emma's approval
  happens outside the tool for now). Roles are two: salesperson and master admin (`config/admins.json`).
- **Suppression list** (§5.5): an opt-out register stored in plain text behind Access — add, check, view, CSV;
  removal is admin-only. Screens are now Compose, Campaigns, Library, Register, Suppressions, Templates (admin).
- **Recipient PII is not stored**: the recipient is used to render the greeting and stripped before the campaign
  is saved; the greeting appears in the email only, never on the public hosted page. A daily Cron purges the
  lookup cache, and campaigns only when a retention period is set.

### As built — 18 to 21 September 2026 (current state in `docs/status-2026-09-21.md`, design in `docs/architecture.md`)

- **Brochure discovery is the finder, not §5.8's allowlist harvest** (18 Sept). No per-brand domain list: the
  official UK site is discovered from the search results, its brochure / download / model pages are read, and a
  document attaches only after it has been read and passes the checks (make and model, UK evidence, document type,
  edition age). The rep never picks from a list. Outcomes are six statuses plus a `documentType`; a manufacturer's
  own **web brochure** is accepted as a link (`Brochure.kind` gained `web`); "nothing found" carries a trace of what
  was checked. §5.8 steps 3 and 5 and the allowlist assumption in §9 no longer describe the build.
  The as-built rules and evidence are in `docs/status-2026-09-18.md` §2–§4 and `docs/status-2026-09-21.md` §3 and
  §8; `docs/brochure-finder-brief.md` holds the problem statement and the ORIGINAL design (rep picks from a list),
  which was dropped — read its banner first.
- **A European English-language brochure is the fallback** (21 Sept) when no UK edition verifies: same official
  source, brochure only (never a European price guide, never the rest of the world), in English. It is **offered to
  the rep, never attached by itself**: they use it, put their own in its place, or send without. Accepted, it is
  stored with `market: 'eu'`, titled "European edition", and the card's small print tells the recipient
  ("This is the manufacturer's European brochure; specification, equipment and prices may differ from UK models.").
  That sentence extends §5.8 step 9 and is Emma's to approve.
- **One offer per row** (21 Sept). §5.1's `layout` and §7.1's four layouts stand in the schema, but the tool sends a
  single offer as the hero card and two to six as stacked rows; the two-up and three-up grids are no longer offered
  and the layout picker (§7.2 screen 2) is gone. Reason: side-by-side cards crowded the email and were the hard part
  to render alike everywhere.
- **The send path is a paste into New Outlook, and it rewrites the HTML** (21 Sept). The Graph draft of §5.4 is
  still parked on IT, so Copy-for-Outlook is how every email goes out. The paste drops the `<style>` block and the
  conditional comments and flattens text colour and size, so the email may not depend on a media query or on
  `[if mso]`: the wrapper is fluid, badges are not floated, the stack card's image column is fluid inline. **The flattened
  text colour and size** (the red 28px price and the red make name arriving black and body-sized) **is Outlook's
  Merge-formatting paste** (22 Sept; `status-2026-09-21.md` §11): with Keep source formatting the markup arrives as
  designed, so the fix is the rep's paste mode, not the markup. The
  current target is Gmail and New Outlook (desktop and mobile); §8.3's full client list is not yet attempted.
- **Test sends run on production storage** (`pnpm dev:live`): a campaign made on local storage points its images and
  links at production, which does not have them.
- **Production is v0.5.0**; `/api` is still 503 there until Cloudflare Access exists, and `mailer.dreamlease.co.uk`
  (§5.7) turned out to be already in use, so the tool needs a different subdomain.

## 9. Assumptions and open items

- Salary sacrifice 20% and 40% figures are entered by hand for now. A `salsac.gross` field and a calculator hook are reserved so the HMRC-verified calculator logic can be plugged in later.
- Reps' WhatsApp numbers and Microsoft Bookings pages are entered once in their sender profile; a rep without them simply doesn't get those CTA presets. Department senders (sales@) get the department number and a shared Bookings page if one exists.
- Sender is usually the rep's own mailbox, with a department mailbox option (sales@, renewals@). Shared mailbox drafting needs `Mail.ReadWrite.Shared` and the user must already hold Send As (or Send on Behalf) on the mailbox in Exchange, otherwise the draft can't be sent from that address.
- The offer feed exists but access is unconfirmed. Until then the URL scraper is the lookup; the `feed` adapter stays a stub.
- Approved compliance wording is to be supplied by me and approved by Emma in the tool before the first real send.
- Cloudflare Access with Entra ID as identity provider, and a second Entra app registration for Graph, are acceptable to the business; IT sets up both and consents to the Graph app once.
- Whether the hosted page subdomain should be `offers.dreamlease.co.uk` or something else is my call; placeholder for now.
- The manufacturer UK domain allowlist for brochures is mine to seed and maintain; a model whose brand isn't on it falls to the manual path until I add the domain. Manufacturers that only offer brochures behind a "request a brochure" form are handled by linking to that page (`kind: 'gated'`); the recipient gives their details to the manufacturer, not to us, and we only see the click. Rehosting manufacturer brochures on our domain is assumed acceptable, as it is standard broker practice, but linking to the manufacturer's URL instead is a one-line change if we're asked to.
- Renewals process detail (which monday.com board, which fields) is not yet defined; the `RecipientContext` shape above is my best guess and should be treated as changeable until the board exists.
