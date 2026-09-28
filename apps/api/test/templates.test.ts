/**
 * Template admin (step 7) — compliance alone changes the wording (Matt, 28 Sept 2026), approved templates immutable.
 * Runs inside workerd with real local D1. `emma.airey@dreamlease.co.uk` is the configured compliance approver
 * (config/compliance.json); `matt.wilson@dreamlease.co.uk` is a master admin (config/admins.json), who can read
 * templates but not change them.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { fixtureTemplate } from '@offer-mailer/render/fixtures';
import app from '../src/index.js';
import type { Env } from '../src/env.js';
import { SAME_ORIGIN } from './same-origin.js';

const COMPLIANCE = 'emma.airey@dreamlease.co.uk';
const as = (email: string, over: Partial<Env> = {}): Env => ({ ...env, DEV_USER_EMAIL: email, ...over }) as Env;
const compliance = as(COMPLIANCE);
const admin = as('matt.wilson@dreamlease.co.uk');
const salesperson = as('sam.carter@dreamlease.co.uk');

const body = { name: 'Autumn 2026', complianceBlocks: fixtureTemplate.complianceBlocks, footer: fixtureTemplate.footer };
const create = (e: Env, over: Record<string, unknown> = {}) =>
  app.request('/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...over }) }, e);
const post = (path: string, e: Env) => app.request(path, { method: 'POST', headers: SAME_ORIGIN }, e);
type Tmpl = { id: string; status: string; version: number; markupVersion: number; approvedBy?: string; approvedAt?: string; name: string };

describe('who can touch the compliance wording', () => {
  it('a salesperson can neither read nor change templates', async () => {
    expect((await app.request('/api/templates', {}, salesperson)).status).toBe(403);
    expect((await create(salesperson, { name: 'Nope' })).status).toBe(403);
  });

  it('a master admin can read templates but not create, edit, publish or retire them', async () => {
    const { template } = (await (await create(compliance, { name: 'Admin read test' })).json()) as { template: Tmpl };

    expect((await app.request('/api/templates', {}, admin)).status).toBe(200);
    expect((await app.request(`/api/templates/${template.id}`, {}, admin)).status).toBe(200);

    expect((await create(admin, { name: 'Admin create' })).status).toBe(403);
    const put = await app.request(`/api/templates/${template.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Admin edit' }) }, admin);
    expect(put.status).toBe(403);
    expect((await post(`/api/templates/${template.id}/publish`, admin)).status).toBe(403);
    expect((await post(`/api/templates/${template.id}/retire`, admin)).status).toBe(403);

    // and nothing changed
    const after = ((await (await app.request(`/api/templates/${template.id}`, {}, compliance)).json()) as { template: Tmpl }).template;
    expect(after.status).toBe('draft');
    expect(after.name).toBe('Admin read test');
  });

  it('COMPLIANCE_EMAILS adds an approver at runtime, case-insensitively', async () => {
    const deputy = as('Deputy.Compliance@dreamlease.co.uk', { COMPLIANCE_EMAILS: 'deputy.compliance@dreamlease.co.uk' });
    expect((await create(deputy, { name: 'Deputy test' })).status).toBe(201);
  });

  it('/me tells the web app who is a compliance approver', async () => {
    const flag = async (e: Env) => ((await (await app.request('/api/me', {}, e)).json()) as { complianceApprover: boolean }).complianceApprover;
    expect(await flag(compliance)).toBe(true);
    expect(await flag(admin)).toBe(false);
    expect(await flag(salesperson)).toBe(false);
  });
});

describe('template lifecycle (as compliance)', () => {
  it('creates a draft (v1, markup pinned, not approved), then lists and gets it', async () => {
    const res = await create(compliance, { name: 'Create test' });
    expect(res.status).toBe(201);
    const { template } = (await res.json()) as { template: Tmpl };
    expect(template.status).toBe('draft');
    expect(template.version).toBe(1);
    expect(template.markupVersion).toBeGreaterThan(0);
    expect(template.approvedBy).toBeUndefined();

    const list = (await (await app.request('/api/templates', {}, compliance)).json()) as { templates: Tmpl[] };
    expect(list.templates.some((t) => t.id === template.id)).toBe(true);
    expect((await app.request(`/api/templates/${template.id}`, {}, compliance)).status).toBe(200);
  });

  it('edits a draft, publishes it (stamped with the approver), then locks the approved one and versions the next edit', async () => {
    const { template } = (await (await create(compliance, { name: 'Lock test' })).json()) as { template: Tmpl };

    // a draft is editable (edit the footer wording; the name identifies the version lineage)
    const put = await app.request(`/api/templates/${template.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ footer: { optOutLine: 'Reply STOP to opt out.', companyLine: fixtureTemplate.footer.companyLine } }) }, compliance);
    expect(put.status).toBe(200);

    // publish -> approved, stamped with the compliance approver who pressed Publish
    const pub = await post(`/api/templates/${template.id}/publish`, compliance);
    expect(pub.status).toBe(200);
    const approved = ((await pub.json()) as { template: Tmpl }).template;
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe(COMPLIANCE);
    expect(approved.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // the approved template is locked — editing it is refused
    const put2 = await app.request(`/api/templates/${template.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'nope' }) }, compliance);
    expect(put2.status).toBe(409);

    // republishing an already-approved template is refused
    expect((await post(`/api/templates/${template.id}/publish`, compliance)).status).toBe(409);

    // a new draft of the same name is the next version, and starts as a draft
    const v2 = ((await (await create(compliance, { name: 'Lock test' })).json()) as { template: Tmpl }).template;
    expect(v2.version).toBe(template.version + 1);
    expect(v2.status).toBe('draft');
  });

  it('rejects an invalid template and a missing one', async () => {
    expect((await app.request('/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '' }) }, compliance)).status).toBe(422);
    expect((await app.request('/api/templates/does-not-exist', {}, compliance)).status).toBe(404);
    expect((await post('/api/templates/does-not-exist/publish', compliance)).status).toBe(404);
  });

  it('retires a template', async () => {
    const { template } = (await (await create(compliance, { name: 'Retire test' })).json()) as { template: Tmpl };
    const res = await post(`/api/templates/${template.id}/retire`, compliance);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { template: Tmpl }).template.status).toBe('retired');
  });
});
