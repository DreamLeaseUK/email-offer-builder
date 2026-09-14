/**
 * Fixture campaigns for tests and the dev preview. Same six vehicles as the v4 design file, so the
 * rendered output can be compared against the Claude Design canvas. Figures are illustrative.
 */
import type { Brochure, Campaign, ContractType, Offer, Sender, Template } from '@offer-mailer/schema';

export const NOW = '2026-09-14T09:00:00.000Z';
const by = 'sam.carter@dreamlease.co.uk';

export const senderRep: Sender = {
  kind: 'user',
  displayName: 'Sam Carter',
  email: by,
  phone: '01234 567 890',
  jobTitle: 'Account Manager, DreamLease',
  whatsapp: '+447700900123',
  bookingUrl: 'https://outlook.office.com/book/DreamLease@dreamlease.co.uk/',
  mailbox: by,
};

export const senderShared: Sender = {
  kind: 'shared',
  displayName: 'DreamLease Sales Team',
  email: 'sales@dreamlease.co.uk',
  phone: '0330 000 0000',
  mailbox: 'sales@dreamlease.co.uk',
};

interface Seed {
  id: string;
  slug: string;
  make: string;
  model: string;
  derivative: string;
  monthly: number;
  initial: number;
  hot?: string;
  badges: string[];
  valid: string;
  stats: [string, string][];
}

const seeds: Seed[] = [
  { id: 'a1b2c3d4-0001-4000-8000-000000000001', slug: 'byd-seal', make: 'BYD', model: 'Seal', derivative: 'Design 82.5kWh Excellence AWD 4dr Auto', monthly: 389, initial: 3501, hot: 'DreamLease exclusive!', badges: ['In stock', 'Special offer'], valid: '2026-09-30', stats: [['Range', '323 mi'], ['0–62', '3.8s'], ['Battery', '82.5 kWh'], ['Warranty', '6 yrs']] },
  { id: 'a1b2c3d4-0002-4000-8000-000000000002', slug: 'mg4-ev', make: 'MG', model: 'MG4 EV', derivative: 'Trophy Long Range 64kWh 5dr Auto', monthly: 249, initial: 2241, hot: 'Special offer', badges: ['In stock'], valid: '2026-09-30', stats: [['Range', '281 mi'], ['0–62', '7.9s'], ['Battery', '64 kWh'], ['Warranty', '7 yrs']] },
  { id: 'a1b2c3d4-0003-4000-8000-000000000003', slug: 'kia-ev3', make: 'Kia', model: 'EV3', derivative: 'GT-Line 81.4kWh 5dr Auto', monthly: 329, initial: 2961, badges: ['Factory order'], valid: '2026-10-15', stats: [['Range', '375 mi'], ['0–62', '7.9s'], ['Battery', '81.4 kWh'], ['Warranty', '7 yrs']] },
  { id: 'a1b2c3d4-0004-4000-8000-000000000004', slug: 'cupra-born', make: 'Cupra', model: 'Born', derivative: 'V2 59kWh 204PS 5dr Auto', monthly: 299, initial: 2691, hot: 'Hot offer', badges: ['In stock', 'Limited numbers'], valid: '2026-09-30', stats: [['Range', '264 mi'], ['0–62', '7.0s'], ['Battery', '59 kWh'], ['Warranty', '3 yrs']] },
  { id: 'a1b2c3d4-0005-4000-8000-000000000005', slug: 'hyundai-kona-electric', make: 'Hyundai', model: 'Kona Electric', derivative: 'Advance 65kWh 218PS 5dr Auto', monthly: 279, initial: 2511, badges: ['In stock'], valid: '2026-10-07', stats: [['Range', '319 mi'], ['0–62', '7.8s'], ['Battery', '65 kWh'], ['Warranty', '5 yrs']] },
  { id: 'a1b2c3d4-0006-4000-8000-000000000006', slug: 'skoda-elroq', make: 'Skoda', model: 'Elroq', derivative: 'SE L 82kWh 85 5dr Auto', monthly: 339, initial: 3051, hot: 'Special offer', badges: ['Factory order'], valid: '2026-09-30', stats: [['Range', '360 mi'], ['0–62', '6.6s'], ['Battery', '82 kWh'], ['Warranty', '3 yrs']] },
];

export function fixtureOffer(seed: Seed, contractType: ContractType): Offer {
  const business = contractType === 'business';
  const salsac = contractType === 'salary_sacrifice';
  const path = business ? 'business' : 'personal';
  const offer: Offer = {
    id: seed.id,
    source: { kind: 'url', ref: `https://www.dreamlease.co.uk/offers/${path}/${seed.slug}/`, fetchedAt: NOW },
    vehicle: { make: seed.make, model: seed.model, derivative: seed.derivative, stats: seed.stats.map(([label, value]) => ({ label, value })) },
    contractType,
    pricing: {
      monthly: business ? Math.round(seed.monthly / 1.2) : seed.monthly, // illustrative only
      vat: business ? 'ex' : 'inc',
      initialPayment: business ? Math.round(seed.initial / 1.2) : seed.initial,
      initialMonths: 9,
      termMonths: 36,
      annualMileage: 8000,
      processingFee: 299.99,
      maintenance: salsac,
    },
    badges: seed.badges,
    offerUrl: `https://www.dreamlease.co.uk/offers/${path}/${seed.slug}/?offer=p-9-36-8000-n&initialRental=9&contractLength=36&annualMileage=8000&includeMaintenance=${salsac}`,
    validUntil: seed.valid,
    createdBy: by,
    createdAt: NOW,
    updatedAt: NOW,
  };
  if (seed.hot) offer.hotBadge = seed.hot;
  if (salsac) {
    // illustrative: hand-entered in the tool, never derived
    offer.pricing.salsac = { net20: Math.round(seed.monthly * 0.68), net40: Math.round(seed.monthly * 0.56), gross: seed.monthly };
  }
  return offer;
}

export const fixtureBrochurePdf: Brochure = {
  id: 'b0000000-0000-4000-8000-000000000001',
  vehicleKey: 'kia/ev3',
  title: 'Kia EV3 brochure (UK)',
  kind: 'pdf',
  file: { key: `brochures/${'c'.repeat(64)}.pdf`, url: `https://offers.dreamlease.co.uk/b/b0000000-0000-4000-8000-000000000001`, sizeBytes: 8_400_000, sha256: 'c'.repeat(64) },
  sourceUrl: 'https://www.kia.co.uk/content/dam/kia/uk/brochures/ev3.pdf',
  source: 'harvest',
  ukVerified: { by: 'domain' },
  fetchedAt: NOW,
  expiresAt: '2026-12-13T09:00:00.000Z',
  status: 'current',
  createdBy: by,
};

export const fixtureBrochureGated: Brochure = {
  id: 'b0000000-0000-4000-8000-000000000002',
  vehicleKey: 'byd/seal',
  title: 'BYD Seal brochure (UK)',
  kind: 'gated',
  sourceUrl: 'https://www.byd.com/uk/brochure-request',
  source: 'harvest',
  ukVerified: { by: 'domain' },
  fetchedAt: NOW,
  expiresAt: '2026-12-13T09:00:00.000Z',
  status: 'current',
  createdBy: by,
};

export const fixtureTemplate: Template = {
  id: 't0000000-0000-4000-8000-000000000001',
  name: 'Offer mailer',
  version: 1,
  markupVersion: 1,
  complianceBlocks: {
    personal: {
      title: 'Personal contract hire',
      paragraphs: [
        'Prices shown include VAT and are based on the term, annual mileage and initial payment stated on each offer. Excess mileage charges and a fair wear and tear standard apply at the end of the agreement.',
        'A processing fee of £299.99 inc VAT is payable on all orders. At the end of the lease the vehicle must be returned in its original condition. You will not own the vehicle.',
        'Offers are subject to status and availability, are for UK residents aged 18 or over, and are valid until the date shown on each offer. Guarantees may be required.',
        'DreamLease Ltd is a credit broker, not a lender, and is authorised and regulated by the Financial Conduct Authority, firm reference number [000000]. We may receive commission from the funder for introducing your business.',
      ],
    },
    business: {
      title: 'Business contract hire',
      paragraphs: [
        'Prices shown exclude VAT and are based on the term, annual mileage and initial payment stated on each offer. Business contract hire is available to limited companies, partnerships and sole traders. Excess mileage charges and a fair wear and tear standard apply.',
        'A processing fee of £299.99 inc VAT is payable on all orders. At the end of the lease the vehicle must be returned in its original condition. Your business will not own the vehicle.',
        "Offers are subject to status and availability and are valid until the date shown on each offer. Directors' guarantees may be required.",
        'DreamLease Ltd is a credit broker, not a lender, and is authorised and regulated by the Financial Conduct Authority, firm reference number [000000]. We may receive commission from the funder for introducing your business.',
      ],
    },
    salary_sacrifice: {
      title: 'Salary sacrifice car scheme',
      paragraphs: [
        "Net monthly figures are illustrative, based on a 20% and 40% income tax payer with standard National Insurance, and depend on your employer's scheme rules and your personal circumstances. Your take-home pay will reduce and Benefit in Kind tax applies.",
        'The agreement is between your employer and the funder. Term, mileage, maintenance and insurance are as stated on each offer. Early termination and excess mileage charges may apply through the scheme.',
        'Offers are subject to scheme eligibility, status and availability, and are valid until the date shown on each offer. Your employer will confirm the final figures before any order is placed.',
        'DreamLease Ltd is a credit broker, not a lender, and is authorised and regulated by the Financial Conduct Authority, firm reference number [000000].',
      ],
    },
  },
  footer: {
    optOutLine: "Don't want offers from DreamLease? Reply to this email and tell us, and we'll stop.",
    companyLine: 'DreamLease Ltd, [registered address], registered in England and Wales no. [00000000].',
  },
  approvedBy: 'emma.airey@dreamlease.co.uk',
  approvedAt: NOW,
  status: 'approved',
};

export interface FixtureOptions {
  offerCount?: number;
  contractType?: ContractType;
  layout?: Campaign['layout'];
  cta?: Offer['cta'];
  brochure?: 'none' | 'pdf' | 'gated';
  sender?: 'rep' | 'shared';
  preheader?: string;
}

export function fixtureCampaign(o: FixtureOptions = {}): { campaign: Campaign; brochures: Record<string, Brochure> } {
  const count = Math.min(6, Math.max(1, o.offerCount ?? 3));
  const contractType = o.contractType ?? 'personal';
  const offers = seeds.slice(0, count).map((s) => fixtureOffer(s, contractType));
  const brochures: Record<string, Brochure> = {};
  if (o.cta) for (const offer of offers) offer.cta = o.cta;
  if (o.brochure && o.brochure !== 'none') {
    const b = o.brochure === 'pdf' ? fixtureBrochurePdf : fixtureBrochureGated;
    brochures[b.id] = b;
    for (const offer of offers) offer.brochure = { brochureId: b.id, include: true };
  }
  const sender = o.sender === 'shared' ? senderShared : senderRep;
  const campaign: Campaign = {
    id: 'c0000000-0000-4000-8000-000000000001',
    name: 'Priya follow-up',
    useCase: 'follow_up',
    templateId: fixtureTemplate.id,
    templateVersion: fixtureTemplate.version,
    subject: 'The electric options we talked about',
    preheader: o.preheader ?? 'Three electric options on 36 months, 8,000 miles a year.',
    intro:
      'Thanks for your time on the call yesterday. As promised, here are the electric options that fit the budget we talked about, all on 36 months with 8,000 miles a year.\n\nPrices move quickly on these, so if one stands out let me know this week and I\'ll hold the quote for you.',
    layout: o.layout ?? 'auto',
    offers,
    recipient: { firstName: 'Priya', email: 'priya@example.com' },
    sender,
    compliance: { variant: contractType, approvedWordingVersion: 1 },
    hostedPage: { slug: 'k3J9xQ2mZp8LwN4vR7tY', url: 'https://offers.dreamlease.co.uk/c/k3J9xQ2mZp8LwN4vR7tY', enabled: true },
    tracking: { campaignCode: 'C-2026-0001', utm: {} },
    status: 'draft',
    createdBy: by,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return { campaign, brochures };
}
