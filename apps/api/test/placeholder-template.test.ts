/**
 * The placeholder compliance template (campaigns.ts DEFAULT_TEMPLATE) is seeded on first use so the tool can be
 * tested before compliance publishes real wording. It must never claim an approver (28 Sept 2026: production showed
 * "approved by" Emma for wording she had not approved), and the first template compliance publishes must replace
 * it for new campaigns. Runs inside workerd with real local D1; this file's database starts empty.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { fixtureCampaign } from '@offer-mailer/render/fixtures';
import app from '../src/index.js';
import { PLACEHOLDER_TEMPLATE_NAME } from '../src/campaigns.js';
import type { Env } from '../src/env.js';
import { SAME_ORIGIN } from './same-origin.js';

const PLACEHOLDER_ID = 'd1000000-0000-4000-8000-000000000001';
const as = (email: string): Env => ({ ...env, DEV_USER_EMAIL: email }) as Env;
const compliance = as('emma.airey@dreamlease.co.uk');
const salesperson = as('sam.carter@dreamlease.co.uk');
type Tmpl = { id: string; name: string; status: string; approvedBy?: string };

function draft() {
  const { campaign } = fixtureCampaign({ offerCount: 1, brochure: 'none' });
  return { name: campaign.name, useCase: campaign.useCase, subject: campaign.subject, intro: campaign.intro, layout: campaign.layout, offers: campaign.offers, sender: campaign.sender };
}
const campaignTemplateId = async (e: Env): Promise<string> => {
  const res = await app.request('/api/campaigns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft()) }, e);
  expect(res.status).toBe(201);
  return ((await res.json()) as { campaign: { templateId: string } }).campaign.templateId;
};

describe('placeholder compliance template', () => {
  it('is seeded on first use, named as a placeholder, with no approver; then compliance’s first template replaces it', async () => {
    expect(await campaignTemplateId(salesperson)).toBe(PLACEHOLDER_ID);

    const seeded = ((await (await app.request(`/api/templates/${PLACEHOLDER_ID}`, {}, compliance)).json()) as { template: Tmpl }).template;
    expect(seeded.name).toBe(PLACEHOLDER_TEMPLATE_NAME);
    expect(seeded.status).toBe('approved');
    expect(seeded.approvedBy).toBeUndefined();

    // compliance publishes real wording (v1 of its own name, the same version number as the placeholder)
    const created = await app.request('/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Autumn 2026', ...templateBody(seeded) }) }, compliance);
    expect(created.status).toBe(201);
    const real = ((await created.json()) as { template: Tmpl }).template;
    expect((await app.request(`/api/templates/${real.id}/publish`, { method: 'POST', headers: SAME_ORIGIN }, compliance)).status).toBe(200);

    expect(await campaignTemplateId(salesperson)).toBe(real.id);
  });
});

/** The editable parts of a template, copied from an existing one. */
function templateBody(t: unknown) {
  const { complianceBlocks, footer } = t as { complianceBlocks: unknown; footer: unknown };
  return { complianceBlocks, footer };
}
