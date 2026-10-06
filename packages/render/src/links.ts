/**
 * Link registry — brief §5.6.
 * Every http(s) link in the email goes through /r/<hostedSlug>/<linkId>, which logs the click and
 * redirects. mailto: and tel: go direct (non-http redirects are unreliable in email clients and the
 * click is the phone ringing anyway).
 */
export class Links {
  readonly map: Record<string, string> = {};

  constructor(
    private readonly publicBaseUrl: string,
    private readonly slug: string,
  ) {}

  /** Register a destination and return the href to put in the email. */
  track(linkId: string, destination: string): string {
    if (/^(mailto|tel):/i.test(destination)) return destination;
    if (this.map[linkId] && this.map[linkId] !== destination) {
      throw new Error(`link id "${linkId}" registered twice with different destinations`);
    }
    this.map[linkId] = destination;
    return `${this.publicBaseUrl}/r/${this.slug}/${linkId}`;
  }
}

/** Append UTM parameters to a dreamlease.co.uk URL. */
export function withUtm(url: string, utm: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(utm)) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * The campaign-level UTM base for our own dreamlease.co.uk links: identifies the tool, the medium and the
 * campaign, plus — via `extra` (from `campaign.tracking.utm`) — the salesperson (`utm_term`). Offer links add
 * `utm_content` (the offer id) on top; the footer homepage link uses the base as-is.
 */
export function campaignUtm(campaignCode: string, extra: Record<string, string> = {}): Record<string, string> {
  return { utm_source: 'offer_mailer', utm_medium: 'email', utm_campaign: campaignCode, ...extra };
}

/**
 * A file the tool stored itself (a car picture under /f/vehicles/, a salesperson's photo under /f/headshots/) is
 * served by every address of the Worker, so point it at today's public address. An offer or photo saved before the
 * address changed (6 Oct 2026: workers.dev to offers.dreamlease.co.uk) then follows the change instead of showing the
 * old address in a new email. Anything else is left exactly as it is.
 */
export function ownFileUrl(url: string, publicBaseUrl: string): string {
  try {
    const { pathname } = new URL(url);
    return /^\/f\/(vehicles|headshots)\//.test(pathname) ? `${publicBaseUrl.replace(/\/$/, '')}${pathname}` : url;
  } catch {
    return url;
  }
}
