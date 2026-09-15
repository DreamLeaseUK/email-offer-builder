# DreamLease Design System

React component library + design tokens distilled from the official brand assets:
**DreamLease Brand Sheet** and **Logo Guidelines (Feb 2021)**, with Sofia Pro
converted from OTF to woff2.

## Structure

```
styles/dreamlease.css   Single canonical stylesheet: @font-face + CSS custom
                        properties (tokens) + all component classes (dl-*)
tokens/tokens.ts        The same tokens as typed TypeScript constants
components/*.tsx        React components (no dependencies beyond React)
fonts/*.woff2           Sofia Pro 300/400/400i/500/600/700/900 (~48KB each)
previews/*.html         Static preview cards for the Claude Design pane
```

## Usage (React)

```tsx
import 'dreamlease-design-system/styles/dreamlease.css';
import { Button, OfferCard, Header, Alert, colors } from './components';

<Button variant="primary">Get a quote</Button>
<OfferCard make="Volkswagen" model="Passat Estate" monthly="£299"
           terms="48 months · 8,000 miles p.a." badge={{ label: 'Hot deal' }} />
```

Wrap your app (or any subtree) in `className="dl-root"` to get the base
typography and colours.

## Design language: aligned to the LIVE site (v1.1)

This system matches the **production dreamlease.co.uk design language**
(verified against the live stylesheet, 2026-07-09), because pages built with
it are served seamlessly into the main site via a Cloudflare origin rule.
Where the official Brand Sheet and the live site disagree, the live site wins.

- **CTAs are green** `#31BD51` (hover `#47CF66` + soft green glow), white
  label, pill shape, 500 weight — exactly the live `.button`. Outline
  buttons are green-bordered with a red label (live `.button--outline`).
- **Ignition Red `#E30613`** (Pantone 485) is for prices, badges, links,
  eyebrows and accents — always at 100%, never tinted (darken to `#C1050F`).
- **Headings are black `#000`**, Sofia Pro Bold (h1 33px, h2 26px). **Body
  text is Graphite `#787580`**; muted text `#928F99`; borders `#E1E0E4`;
  dark surfaces/footer `#393838`.
- **Sizes are px, not rem** — the production theme sets
  `html{font-size:62.5%}`, so rem-based sizing renders at 62.5% scale.
- **Brand-sheet extension colours** (Midnight Drive `#002E5F`, Skybound
  `#71C5E9`, Flashpoint `#FF8811`) do NOT appear in live page chrome — use
  them only for functional states the current site doesn't have (info/
  warning alerts on richer WP7 pages).
- **Type**: Sofia Pro. Headings = Bold (700). Body = Medium (500) and
  Regular (400). Display moments may use Black (900).
- **Logo**: favour the light-background version on pure white; D-sized
  clearance zone; minimum width 20mm; never distort, recolour, or break the
  pictogram/text ratio; never place on high-contrast backgrounds.

## Caveats

- `components/Logo.tsx` carries the **official logo vectors**, extracted
  directly from `Dream Lease Logo AI FILE.ai` (the brand master file) —
  exact letterforms, pictogram and dream bubbles. Never edit the path data.
- Sofia Pro is a licensed typeface (Mostardesign). The woff2 files here are
  converted from the company's purchased OTFs — keep them inside DreamLease
  properties and don't redistribute.
