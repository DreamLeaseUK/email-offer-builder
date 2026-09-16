/**
 * Template admin (build step 7) — master-admin only. A template carries the per-contract-type compliance
 * blocks and footer that render() locks into every email (rule 3, compliance is locked).
 *
 * Approved templates are IMMUTABLE. To change wording the admin creates a new draft version, edits it,
 * and publishes it — publish = self-approve (the separate approver role is parked). Campaigns pin the
 * wording version they rendered against, so old approved versions stay resolvable; new campaigns use the
 * newest approved (see campaigns.ts `approvedDefault`, which orders by version).
 *
 *   GET    /api/templates             list all, newest first
 *   GET    /api/templates/:id         one
 *   POST   /api/templates             create a new draft (server sets id, version, markupVersion, status)
 *   PUT    /api/templates/:id         edit a DRAFT (approved/retired are locked -> 409)
 *   POST   /api/templates/:id/publish draft -> approved, stamped with the admin + time
 *   POST   /api/templates/:id/retire  remove a template from the approved rotation
 */
import { MARKUP_VERSION } from '@offer-mailer/render';
import { ComplianceBlock, ContractType, Template, assertNoCapId } from '@offer-mailer/schema';
import type { Template as TemplateT } from '@offer-mailer/schema';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from './db/index.js';
import { templates as templatesTable } from './db/schema.js';
import type { AppEnv, Env } from './env.js';
import { requireAdmin } from './roles.js';

/** The admin-authored parts of a template. Identity, version, markupVersion and status are server-owned. */
const TemplateBody = z.object({
  name: z.string().min(1).max(120),
  complianceBlocks: z.record(ContractType, ComplianceBlock),
  footer: z.object({ optOutLine: z.string().min(1), companyLine: z.string().min(1) }),
});

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');

function templatesAdminRepo(env: Env) {
  const d = db(env.DB);
  const row = (t: TemplateT) => ({ id: t.id, name: t.name, version: t.version, status: t.status, approvedBy: t.approvedBy ?? null, approvedAt: t.approvedAt ?? null, data: t });
  return {
    async list(): Promise<TemplateT[]> {
      const rows = await d.select().from(templatesTable).orderBy(desc(templatesTable.createdAt)).all();
      return rows.map((r) => Template.parse(r.data));
    },
    async get(id: string): Promise<TemplateT | undefined> {
      const found = await d.select().from(templatesTable).where(eq(templatesTable.id, id)).get();
      return found ? Template.parse(found.data) : undefined;
    },
    /** The next version number for a template name (1 for a brand-new name). */
    async nextVersion(name: string): Promise<number> {
      const rows = await d.select({ version: templatesTable.version }).from(templatesTable).where(eq(templatesTable.name, name)).all();
      return rows.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    },
    async create(t: TemplateT): Promise<void> {
      assertNoCapId(t, 'template');
      await d.insert(templatesTable).values({ ...row(t), createdAt: new Date().toISOString() }).run();
    },
    async update(t: TemplateT): Promise<void> {
      assertNoCapId(t, 'template');
      await d.update(templatesTable).set(row(t)).where(eq(templatesTable.id, t.id)).run();
    },
  };
}

export const templatesApi = new Hono<AppEnv>();
templatesApi.use('*', requireAdmin());

templatesApi.get('/templates', async (c) => c.json({ templates: await templatesAdminRepo(c.env).list() }));

templatesApi.get('/templates/:id', async (c) => {
  const t = await templatesAdminRepo(c.env).get(c.req.param('id'));
  return t ? c.json({ template: t }) : c.json({ error: 'Template not found.' }, 404);
});

templatesApi.post('/templates', async (c) => {
  const parsedBody = TemplateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsedBody.success) return c.json({ error: `Those template details are not valid: ${issues(parsedBody.error)}` }, 422);
  const repo = templatesAdminRepo(c.env);
  const t: TemplateT = {
    id: crypto.randomUUID(),
    name: parsedBody.data.name,
    version: await repo.nextVersion(parsedBody.data.name),
    markupVersion: MARKUP_VERSION,
    complianceBlocks: parsedBody.data.complianceBlocks,
    footer: parsedBody.data.footer,
    status: 'draft',
  };
  const parsed = Template.safeParse(t);
  if (!parsed.success) return c.json({ error: `Those template details are not valid: ${issues(parsed.error)}` }, 422);
  await repo.create(parsed.data);
  return c.json({ template: parsed.data }, 201);
});

templatesApi.put('/templates/:id', async (c) => {
  const repo = templatesAdminRepo(c.env);
  const existing = await repo.get(c.req.param('id'));
  if (!existing) return c.json({ error: 'Template not found.' }, 404);
  if (existing.status !== 'draft') return c.json({ error: 'Approved templates are locked. Create a new draft version to change the wording.' }, 409);
  const parsedBody = TemplateBody.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!parsedBody.success) return c.json({ error: `Those template details are not valid: ${issues(parsedBody.error)}` }, 422);
  const next: TemplateT = {
    ...existing,
    ...(parsedBody.data.name ? { name: parsedBody.data.name } : {}),
    ...(parsedBody.data.complianceBlocks ? { complianceBlocks: parsedBody.data.complianceBlocks } : {}),
    ...(parsedBody.data.footer ? { footer: parsedBody.data.footer } : {}),
  };
  const parsed = Template.safeParse(next);
  if (!parsed.success) return c.json({ error: `Those template details are not valid: ${issues(parsed.error)}` }, 422);
  await repo.update(parsed.data);
  return c.json({ template: parsed.data });
});

templatesApi.post('/templates/:id/publish', async (c) => {
  const repo = templatesAdminRepo(c.env);
  const existing = await repo.get(c.req.param('id'));
  if (!existing) return c.json({ error: 'Template not found.' }, 404);
  if (existing.status !== 'draft') return c.json({ error: 'Only a draft template can be published.' }, 409);
  const next: TemplateT = { ...existing, status: 'approved', approvedBy: c.get('user').email, approvedAt: new Date().toISOString() };
  const parsed = Template.safeParse(next);
  if (!parsed.success) return c.json({ error: `Those template details are not valid: ${issues(parsed.error)}` }, 422);
  await repo.update(parsed.data);
  return c.json({ template: parsed.data });
});

templatesApi.post('/templates/:id/retire', async (c) => {
  const repo = templatesAdminRepo(c.env);
  const existing = await repo.get(c.req.param('id'));
  if (!existing) return c.json({ error: 'Template not found.' }, 404);
  const next: TemplateT = { ...existing, status: 'retired' };
  await repo.update(next);
  return c.json({ template: next });
});
