import type { Campaign, Offer, Sender } from '../src/index.js';

export const now = '2026-09-11T10:00:00.000Z';

export const sender: Sender = {
  kind: 'user',
  displayName: 'Sam Carter',
  email: 'sam.carter@dreamlease.co.uk',
  phone: '01234 567 890',
  jobTitle: 'Account Manager',
  whatsapp: '+447700900123',
  mailbox: 'sam.carter@dreamlease.co.uk',
};

export const offer: Offer = {
  id: '4f2d7c1e-9a3b-4c5d-8e6f-1a2b3c4d5e6f',
  source: { kind: 'url', ref: 'https://www.dreamlease.co.uk/offers/personal/kia-ev3/', fetchedAt: now },
  vehicle: {
    make: 'Kia',
    model: 'EV3',
    derivative: 'GT-Line 81.4kWh 5dr Auto',
    stats: [
      { label: 'Range', value: '375 mi' },
      { label: '0–62', value: '7.9s' },
      { label: 'Battery', value: '81.4 kWh' },
      { label: 'Warranty', value: '7 yrs' },
    ],
  },
  image: {
    key: 'vehicles/' + 'a'.repeat(64) + '.jpg',
    url: 'https://offers.dreamlease.co.uk/i/' + 'a'.repeat(64) + '.jpg',
    alt: 'Kia EV3',
    width: 1200,
    height: 900,
  },
  contractType: 'personal',
  pricing: {
    monthly: 329,
    vat: 'inc',
    initialPayment: 2961,
    initialMonths: 9,
    termMonths: 36,
    annualMileage: 8000,
    processingFee: 299.99,
    maintenance: false,
  },
  badges: ['Factory order'],
  offerUrl: 'https://www.dreamlease.co.uk/offers/personal/kia-ev3/?offer=p-9-36-8000-n',
  validUntil: '2026-10-15',
  createdBy: 'sam.carter@dreamlease.co.uk',
  createdAt: now,
  updatedAt: now,
};

export const campaign: Campaign = {
  id: '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  name: 'Priya follow-up',
  useCase: 'follow_up',
  templateId: '0c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f',
  templateVersion: 1,
  subject: 'The Kia EV3 offer we talked about',
  intro: 'Thanks for your time on the call yesterday.\nHere is the offer.',
  layout: 'auto',
  offers: [offer],
  sender,
  compliance: { variant: 'personal', approvedWordingVersion: 1 },
  hostedPage: { slug: 'k3J9xQ2mZp8LwN4v', url: 'https://offers.dreamlease.co.uk/c/k3J9xQ2mZp8LwN4v', enabled: true },
  tracking: { campaignCode: 'C-2026-0001', utm: { utm_source: 'offer_mailer', utm_medium: 'email' } },
  status: 'draft',
  createdBy: 'sam.carter@dreamlease.co.uk',
  createdAt: now,
  updatedAt: now,
};
