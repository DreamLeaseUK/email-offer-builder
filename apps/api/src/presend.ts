/**
 * The automatic checks before an email leaves the tool (Phase 1, docs/evolution.md §6; Matt, 29 Sept 2026:
 * salespeople never test emails, the tool refuses to send a faulty one). They run on the email exactly as it will
 * be sent: the stored campaign re-rendered on the server against its own approved template, never HTML from the
 * browser. Send runs all of them; Copy for Outlook runs all but the recipient check (decision 3), so the backup
 * route cannot be used to get round them. A failed check blocks and says what to fix, in plain words.
 *
 * Pure: every outside answer (the clock, the website, the stored files, the suppression list) is injected, so the
 * rules are tested one by one (test/presend.test.ts) and the route wires the real ones (send.ts).
 */
import type { Brochure, Campaign, Offer, Rendered, Template } from '@offer-mailer/schema';
import { findCapIdLeak } from '@offer-mailer/schema';
import { z } from 'zod';

export type CheckId = 'template' | 'priced' | 'valid' | 'live' | 'assets' | 'links' | 'copy' | 'size' | 'capid' | 'recipient';

export interface Check {
  id: CheckId;
  label: string;
  ok: boolean;
  /** What to fix, one line per problem. Empty when ok. */
  problems: string[];
}

export interface PreSendInput {
  campaign: Campaign;
  /** The campaign's own template; undefined when it no longer exists. */
  template: Template | undefined;
  /** The email as it will be sent; undefined when it could not be rendered (renderError says why). */
  rendered: Rendered | undefined;
  renderError?: string;
  /** Every brochure the email includes, by id; undefined when the record no longer exists. */
  brochures: Record<string, Brochure | undefined>;
  /** The link ids stored when the campaign was created: the /r redirect resolves only these. */
  storedLinkIds: string[];
  /** The customer's address. Given for Send; absent for Copy for Outlook, which skips the recipient check. */
  to?: string;
}

export type OfferRecheck = { ok: true; monthly?: number } | { ok: false; problem: string };

export interface PreSendDeps {
  now: Date;
  /** Compliance approvers (config/compliance.json + COMPLIANCE_EMAILS). */
  approvers: Set<string>;
  maxEmailBytes: number;
  /** An offer looked up within this long counts as checked on the website (config/mail.json). */
  offerCheckedMs: number;
  /** Look the offer up on the website again: gone, unreadable, or its current monthly price. */
  recheckOffer(offer: Offer): Promise<OfferRecheck>;
  /** Is one of our stored files there (vehicles/…, headshots/…, brochures/…)? */
  storedFileExists(key: string): Promise<boolean>;
  /** Has someone else's page gone (404 / 410), the rule the daily brochure re-check uses? */
  linkGone(url: string): Promise<boolean>;
  isSuppressed(email: string): Promise<boolean>;
}

const LABELS: Record<CheckId, string> = {
  template: 'Compliance wording approved by compliance',
  priced: 'Every offer has a price',
  valid: 'Every offer is still in date',
  live: 'Every offer is still on the website',
  assets: 'Pictures and brochures are in place',
  links: 'Tracked links work',
  copy: 'Subject and message filled in',
  size: 'Email is small enough to arrive whole',
  capid: 'No CAP ID in the email',
  recipient: "Customer's address is valid and has not opted out",
};

const carName = (o: Offer): string => `${o.vehicle.make} ${o.vehicle.model}`;
const londonToday = (now: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const ukDate = (iso: string): string => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
const gbp = (n: number): string => `£${Math.round(n).toLocaleString('en-GB')}`;

/** Our stored file behind a /f/ URL (vehicles/…, headshots/…, brochures/…), or undefined for anything else. */
export function storedKeyOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const p = new URL(url).pathname;
    return p.startsWith('/f/') ? decodeURIComponent(p.slice(3)) : undefined;
  } catch {
    return undefined;
  }
}

export function isPriced(o: Offer): boolean {
  return o.contractType === 'salary_sacrifice' ? (o.pricing.salsac?.net20 ?? 0) > 0 && (o.pricing.salsac?.net40 ?? 0) > 0 : o.pricing.monthly > 0;
}

export async function runPreSendChecks(input: PreSendInput, deps: PreSendDeps): Promise<Check[]> {
  const { campaign, template, rendered } = input;
  const out: Check[] = [];
  const add = (id: CheckId, problems: string[]) => out.push({ id, label: LABELS[id], ok: problems.length === 0, problems });

  // 1. Rule 3: only wording that a compliance approver published goes to a customer. The placeholder has no approver.
  {
    const p: string[] = [];
    if (!template) p.push('The wording this campaign was made with no longer exists. Create the campaign again.');
    else if (!template.approvedBy || !deps.approvers.has(template.approvedBy.toLowerCase())) {
      p.push('This campaign uses wording that compliance has not approved (the placeholder). Emma must publish the approved wording; then create the campaign again.');
    } else if (template.status !== 'approved') p.push(`The wording this campaign was made with has been ${template.status}. Create the campaign again.`);
    if (!rendered && input.renderError && template && p.length === 0) p.push(`The email could not be built: ${input.renderError}`);
    add('template', p);
  }

  // 2. Priced.
  add(
    'priced',
    campaign.offers.filter((o) => !isPriced(o)).map((o) => (o.contractType === 'salary_sacrifice' ? `${carName(o)}: enter both net monthly figures.` : `${carName(o)} has no monthly price.`)),
  );

  // 3. In date (validUntil is the last day, inclusive, UK time).
  const today = londonToday(deps.now);
  add(
    'valid',
    campaign.offers.filter((o) => o.validUntil < today).map((o) => `${carName(o)} ended on ${ukDate(o.validUntil)}. Remove it, or add the current offer again.`),
  );

  // 4. Still on the website: a recent look-up counts; an older offer is looked up again (decision 2, 29 Sept 2026).
  {
    const results = await Promise.all(
      campaign.offers.map(async (o): Promise<string | undefined> => {
        const fetched = o.source.fetchedAt ? Date.parse(o.source.fetchedAt) : NaN;
        if (Number.isFinite(fetched) && deps.now.getTime() - fetched <= deps.offerCheckedMs) return undefined;
        const r = await deps.recheckOffer(o);
        if (!r.ok) return `${carName(o)}: ${r.problem}`;
        if (o.contractType !== 'salary_sacrifice' && r.monthly !== undefined && Math.round(r.monthly) !== Math.round(o.pricing.monthly)) {
          return `${carName(o)}: the price on the website is now ${gbp(r.monthly)} a month, not ${gbp(o.pricing.monthly)}. Add the offer again so the email shows the current price.`;
        }
        return undefined;
      }),
    );
    add('live', results.filter((x): x is string => !!x));
  }

  // 5. Our pictures and PDFs are stored; brochure pages elsewhere have not gone.
  {
    const p: string[] = [];
    for (const o of campaign.offers) {
      if (o.image && !(await deps.storedFileExists(o.image.key))) p.push(`The picture of the ${carName(o)} is missing. Add the offer again.`);
      if (o.brochure?.include) {
        const b = input.brochures[o.brochure.brochureId];
        if (!b) p.push(`The brochure for the ${carName(o)} no longer exists. Attach it again or turn it off.`);
        else if (b.kind === 'pdf' ? !b.file || !(await deps.storedFileExists(b.file.key)) : await deps.linkGone(b.sourceUrl)) {
          p.push(`The brochure for the ${carName(o)} no longer opens. Attach it again or turn it off.`);
        }
      }
    }
    const headshot = storedKeyOf(campaign.sender.headshotUrl);
    if (headshot && !(await deps.storedFileExists(headshot))) p.push('Your photo is missing. Upload it again in step 3.');
    add('assets', p);
  }

  // 6. Every tracked link in the email resolves: its id is in the link map stored at creation.
  if (rendered) {
    const stored = new Set(input.storedLinkIds);
    const missing = Object.keys(rendered.links).filter((id) => !stored.has(id));
    add('links', missing.length ? [`${missing.length} link(s) in the email would not open. Create the campaign again.`] : []);
  }

  // 7. The salesperson's own copy.
  add('copy', [...(!campaign.subject.trim() ? ['Add a subject line.'] : []), ...(!campaign.intro.trim() ? ['Add your message.'] : [])]);

  if (rendered) {
    // 8. Size: Gmail cuts off a large email, hiding the compliance wording at the bottom.
    const bytes = new TextEncoder().encode(rendered.html).byteLength;
    const kb = (n: number) => Math.round(n / 1024);
    add('size', bytes > deps.maxEmailBytes ? [`The email is ${kb(bytes)} KB; the limit is ${kb(deps.maxEmailBytes)} KB. Shorten your message or remove an offer.`] : []);
    // 9. Rule 2: no CAP ID, in the email or its subject.
    add('capid', findCapIdLeak({ html: rendered.html, subject: rendered.subject }) ? ['The email contains a CAP ID. Do not send it; tell Matt.'] : []);
  }

  // 10. The customer (Send only).
  if (input.to !== undefined) {
    const to = input.to.trim();
    const p: string[] = [];
    if (!z.email().safeParse(to).success) p.push("Enter the customer's email address.");
    else if (await deps.isSuppressed(to)) p.push('This customer asked not to be emailed (they are on the Suppressions list). Do not send.');
    add('recipient', p);
  }

  return out;
}

export const allPassed = (checks: Check[]): boolean => checks.every((c) => c.ok);
