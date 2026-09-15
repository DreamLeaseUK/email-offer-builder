/**
 * DreamLease design tokens.
 * v1.1 — aligned to the LIVE dreamlease.co.uk design language (2026-07-09),
 * verified against the production stylesheet. Where the official Brand Sheet
 * and the live site disagree, the live site wins (WP7 pages behind the
 * Cloudflare origin rule must feel seamless). Red is always used at 100%
 * (never tinted); the live chrome contains no navy/sky/orange — those remain
 * as extension colours for functional states only.
 */

export const colors = {
  /** Live default CTA — the production `.button` green. */
  ctaGreen: '#31BD51',
  /** Live CTA hover. */
  ctaGreenHover: '#47CF66',
  /** Prices, badges, links, accents. Pantone 485. NEVER tint (darken to #C1050F for hover). */
  ignitionRed: '#E30613',
  /** Headings (live h1–h4 are pure black). */
  ink: '#000000',
  /** Dark surfaces (footer), emphasis text, wordmark grey. Pantone 447. */
  dark: '#393838',
  /** Body text — the live site's body colour (Graphite Grey). */
  graphiteGrey: '#787580',
  /** Secondary/muted text (live). */
  textMuted: '#928F99',
  iceWhite: '#FFFFFF',
  /** Light panel background (live). */
  grey100: '#F6F6F7',
  /** Borders (live). */
  grey200: '#E1E0E4',
  /** Stronger borders (live). */
  grey300: '#DCDBDF',
} as const;

/**
 * Brand-sheet extension colours. NOT part of the live page chrome — use only
 * for functional UI the current site doesn't have (info/warning states on
 * the richer WP7 pages).
 */
export const extension = {
  midnightDrive: '#002E5F',
  skyboundBlue: '#71C5E9',
  flashpointOrange: '#FF8811',
  skyTint: '#EAF7FC',
  orangeTint: '#FFF3E5',
  redHover: '#C1050F',
} as const;

export const semantic = {
  bg: colors.iceWhite,
  text: colors.graphiteGrey,
  textSecondary: colors.textMuted,
  heading: colors.ink,
  border: colors.grey200,
  cta: colors.ctaGreen,
  danger: colors.ignitionRed,
  warning: extension.flashpointOrange,
  info: extension.skyboundBlue,
} as const;

export const typography = {
  /** Headings & headlines: Sofia Pro Bold. Body: Sofia Pro Medium & Regular. */
  fontFamily: "'Sofia Pro', sofia-pro, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  weights: { light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, black: 900 },
  /**
   * px on purpose: the production theme sets html{font-size:62.5%}, so
   * rem-based sizes render at 62.5% scale inside WordPress.
   */
  sizes: {
    display: '44px',
    h1: '33px',   // live h1
    h2: '26px',   // live h2
    h3: '22px',
    h4: '18px',
    body: '16px', // live base
    small: '14px',
    caption: '12px',
  },
} as const;

export const spacing = {
  1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px',
  6: '24px', 8: '32px', 10: '40px', 12: '48px',
} as const;

export const radius = {
  sm: '6px',
  md: '10px',
  lg: '16px',
  pill: '999em', // live pill radius
} as const;

export const shadows = {
  sm: '0 1px 3px rgba(57, 56, 56, 0.10)',
  md: '0 4px 16px rgba(57, 56, 56, 0.12)',
  lg: '0 12px 32px rgba(57, 56, 56, 0.16)',
  /** Live button hover glow. */
  cta: '0 4px 25px rgba(80, 210, 109, 0.33)',
} as const;

/** Live transition curve (production .button). */
export const easing = 'cubic-bezier(0.645, 0.045, 0.355, 1)' as const;

/** Logo usage rules (Logo Guidelines, Feb 2021) */
export const logoRules = {
  clearance: 'D-sized clearance zone — no text or graphics inside it',
  minWidthMm: 20,
  rules: [
    'Favour the light-background version, ideally on pure white',
    'Never distort, recolour, or break the pictogram/text size relationship',
    'Never place on high-contrast backgrounds',
    'Corporate red always at 100% — grey tints are allowed, red tints are not',
  ],
} as const;
