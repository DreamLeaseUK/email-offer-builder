/**
 * Template admin (step 7) — master-admin only, approved templates immutable. Runs inside workerd with
 * real local D1. `matt.wilson@dreamlease.co.uk` is the configured admin (config/admins.json).
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { fixtureTemplate } from '@offer-mailer/render/fixtures';
import app from '../src/index.js';
import type { Env } from '../src/env.js';

const USER = 'matt.wilson@dreamlease.co.uk';
const authed = (over: Partial<Env> = {}): Env => ({ ...env, DEV_USER_EMAIL: USER, ...over }) as Env;
const rep = authed({ DEV_USER_EMAIL: 'sam.carter@dreamlease.co.uk' });

const body = { name: 'Autumn 2026', complianceBlocks: fixtureTemplate.complianceBlocks, footer: fixtureTemplate.footer };
const create = (e: Env, over: Record<string, unknown> = {}) =>
  app.request('/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...over }) }, e);
type Tmpl = { id: string; status: string; version: number; markupVersion: number; approvedBy?: string; approvedAt?: string; name: string };

describe('template admin', () => {
  it('is admin-only — a salesperson gets 403', async () => {
    expect((await app.request('/api/templates', {}, rep)).status).toBe(403);
    expect((await create(rep, { name: 'Nope' })).status).toBe(403);
  });

  it('creates a draft (v1, markup pinned, not approved), then lists and gets it', async () => {
    const res = await create(authed(), { name: 'Create test' });
    expect(res.status).toBe(201);
    const { template } = (await res.json()) as { template: Tmpl };
    expect(template.status).toBe('draft');
    expect(template.version).toBe(1);
    expect(template.markupVersion).toBeGreaterThan(0);
    expect(template.approvedBy).toBeUndefined();

    const list = (await (await app.request('/api/templates', {}, authed())).json()) as { templates: Tmpl[] };
    expect(list.templates.some((t) => t.id === template.id)).toBe(true);
    expect((await app.request(`/api/templates/${template.id}`, {}, authed())).status).toBe(200);
  });

  it('edits a draft, publishes it (self-approve), then locks the approved one and versions the next edit', async () => {
    const { template } = (await (await create(authed(), { name: 'Lock test' })).json()) as { template: Tmpl };

    // a draft is editable (edit the footer wording; the name identifies the version lineage)
    const put = await app.request(`/api/templates/${template.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ footer: { optOutLine: 'Reply STOP to opt out.', companyLine: fixtureTemplate.footer.companyLine } }) }, authed());
    expect(put.status).toBe(200);

    // publish -> approved, stamped with the admin
    const pub = await app.request(`/api/templates/${template.id}/publish`, { method: 'POST' }, authed());
    expect(pub.status).toBe(200);
    const approved = ((await pub.json()) as { template: Tmpl }).template;
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe(USER);
    expect(approved.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // the approved template is locked — editing it is refused
    const put2 = await app.request(`/api/templates/${template.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'nope' }) }, authed());
    expect(put2.status).toBe(409);

    // republishing an already-approved template is refused
    expect((await app.request(`/api/templates/${template.id}/publish`, { method: 'POST' }, authed())).status).toBe(409);

    // a new draft of the same name is the next version, and starts as a draft
    const v2 = ((await (await create(authed(), { name: 'Lock test' })).json()) as { template: Tmpl }).template;
    expect(v2.version).toBe(template.version + 1);
    expect(v2.status).toBe('draft');
  });

  it('rejects an invalid template and a missing one', async () => {
    expect((await app.request('/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '' }) }, authed())).status).toBe(422);
    expect((await app.request('/api/templates/does-not-exist', {}, authed())).status).toBe(404);
    expect((await app.request('/api/templates/does-not-exist/publish', { method: 'POST' }, authed())).status).toBe(404);
  });

  it('retires a template', async () => {
    const { template } = (await (await create(authed(), { name: 'Retire test' })).json()) as { template: Tmpl };
    const res = await app.request(`/api/templates/${template.id}/retire`, { method: 'POST' }, authed());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { template: Tmpl }).template.status).toBe('retired');
  });
});
