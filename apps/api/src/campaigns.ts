/**
 * Campaign persistence and delivery-adjacent routes — brief §5.4, §5.6.
 *
 *   POST /api/campaigns            assemble → render → write the hosted page → store the snapshot + link map
 *   GET  /api/campaigns            the caller's campaigns, newest first
 *   GET  /api/campaigns/:id        one campaign
 *   GET  /api/campaigns/:id/stats  clicks and hosted views, scanner hits excluded
 *   GET  /r/:slug/:link            public: resolve a stored link, log the click, redirect (was a stub)
 *
 * The rep supplies the parts they author (name, subject, intro, layout, offers, sender); the server
 * owns identity, the hosted slug, the tracking code, the template and the compliance variant, so a
 * campaign can never be stored against an unapproved template or with mixed contract types. The link
 * map render() produces is stored so the redirect can resolve /r/<slug>/<linkId> without re-rendering.
 */
import { render } from '@offer-mailer/render';
import { fixtureTemplate } from '@offer-mailer/render/fixtures';
import { Campaign, CampaignUseCase, Offer, RecipientContext, Sender, Template, assertNoCapId } from '@offer-mailer/schema';
import type { Campaign as CampaignT, Template as TemplateT } from '@offer-mailer/schema';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { d1BrochureRepo } from './brochures.js';
import { db } from './db/index.js';
import { campaigns as campaignsTable, clicks as clicksTable, templates as templatesTable } from './db/schema.js';
import type { AppEnv, Env } from './env.js';
import { writeHostedPage } from './hosted.js';
import { sendersRepo } from './profile.js';
import { logHit } from './tracking.js';
import type { Brochure } from '@offer-mailer/schema';

/**
 * The working default template until the template admin (build step 7) lets Matt author one and Emma
 * approves it. It reuses the fixture's compliance wording — a starting point, not Emma-approved (see
 * status doc §7) — but with a real UUID, since the fixture's id is a test placeholder, not a valid one.
 */
const DEFAULT_TEMPLATE_ID = 'd1000000-0000-4000-8000-000000000001';
const DEFAULT_TEMPLATE: TemplateT = { ...fixtureTemplate, id: DEFAULT_TEMPLATE_ID };

const DraftCampaign = z.object({
  name: z.string().min(1).max(120),
  useCase: CampaignUseCase,
  subject: z.string().min(1).max(150),
  preheader: z.string().max(150).optional(),
  intro: z.string().min(1).max(4000),
  layout: z.enum(['auto', 'single', 'stack', 'grid2', 'grid3']).default('auto'),
  offers: z.array(Offer).min(1).max(6),
  sender: Sender,
  recipient: RecipientContext.optional(),
  /** Optional; defaults to the approved default template. */
  templateId: z.uuid().optional(),
});
type DraftCampaign = z.infer<typeof DraftCampaign>;

const newId = (): string => crypto.randomUUID();
/** Unguessable hosted slug: 32 hex chars (128 bits), matching the schema's [A-Za-z0-9_-]{16,}. */
const newSlug = (): string => crypto.randomUUID().replace(/-/g, '');
const newCampaignCode = (): string => `C-${crypto.randomUUID().slice(0, 8)}`;

// ---------- repositories ----------

function templatesRepo(env: Env) {
  const d = db(env.DB);
  return {
    async getById(id: string): Promise<TemplateT | undefined> {
      const row = await d.select().from(templatesTable).where(eq(templatesTable.id, id)).get();
      return row ? Template.parse(row.data) : undefined;
    },
    /** The newest approved template, seeding the default once when none exists yet. */
    async approvedDefault(): Promise<TemplateT> {
      const row = await d.select().from(templatesTable).where(eq(templatesTable.status, 'approved')).orderBy(desc(templatesTable.version)).get();
      if (row) return Template.parse(row.data);
      const seed = DEFAULT_TEMPLATE;
      await d
        .insert(templatesTable)
        .values({ id: seed.id, name: seed.name, version: seed.version, status: seed.status, approvedBy: seed.approvedBy ?? null, approvedAt: seed.approvedAt ?? null, createdAt: seed.approvedAt ?? new Date().toISOString(), data: seed })
        .onConflictDoNothing()
        .run();
      return seed;
    },
  };
}

function campaignsRepo(env: Env) {
  const d = db(env.DB);
  return {
    async save(campaign: CampaignT, links: Record<string, string>): Promise<void> {
      assertNoCapId({ campaign, links }, 'campaign');
      await d
        .insert(campaignsTable)
        .values({
          id: campaign.id,
          name: campaign.name,
          useCase: campaign.useCase,
          status: campaign.status,
          hostedSlug: campaign.hostedPage.slug,
          templateId: campaign.templateId,
          templateVersion: campaign.templateVersion,
          createdBy: campaign.createdBy,
          createdAt: campaign.createdAt,
          updatedAt: campaign.updatedAt,
          sentAt: campaign.sentAt ?? null,
          sentVia: campaign.sentVia ?? null,
          links,
          data: campaign,
        })
        .run();
    },
    async get(id: string): Promise<CampaignT | undefined> {
      const row = await d.select().from(campaignsTable).where(eq(campaignsTable.id, id)).get();
      return row ? Campaign.parse(row.data) : undefined;
    },
    /** Just the id and link map for the slug — all the redirect needs. */
    async linksForSlug(slug: string): Promise<{ id: string; links: Record<string, string> } | undefined> {
      const row = await d.select({ id: campaignsTable.id, links: campaignsTable.links }).from(campaignsTable).where(eq(campaignsTable.hostedSlug, slug)).get();
      return row ? { id: row.id, links: (row.links ?? {}) as Record<string, string> } : undefined;
    },
    async listByUser(email: string): Promise<CampaignT[]> {
      const rows = await d.select({ data: campaignsTable.data }).from(campaignsTable).where(eq(campaignsTable.createdBy, email)).orderBy(desc(campaignsTable.createdAt)).all();
      return rows.map((r) => Campaign.parse(r.data));
    },
    /** Every campaign, for the promotions register (Emma's compliance record). */
    async listAll(): Promise<CampaignT[]> {
      const rows = await d.select({ data: campaignsTable.data }).from(campaignsTable).orderBy(desc(campaignsTable.createdAt)).all();
      return rows.map((r) => Campaign.parse(r.data));
    },
  };
}

// ---------- promotions register (brief §5.5) ----------

/** The register's columns, in order — used for both the in-app table and the CSV. */
const REGISTER_FIELDS = [
  ['created', 'Created'],
  ['campaign', 'Campaign'],
  ['useCase', 'Use case'],
  ['status', 'Status'],
  ['sender', 'Sender'],
  ['senderEmail', 'Sender email'],
  ['subject', 'Subject'],
  ['preheader', 'Preheader'],
  ['intro', 'Intro'],
  ['ctaLabels', 'CTA labels'],
  ['offers', 'Offers'],
  ['layout', 'Layout'],
  ['templateVersion', 'Template version'],
  ['wordingVersion', 'Wording version'],
  ['campaignCode', 'Campaign code'],
  ['hostedUrl', 'Hosted URL'],
  ['sentAt', 'Sent at'],
  ['sentVia', 'Sent via'],
] as const;

/** One campaign flattened to the register's fields (the rep-authored copy plus the metadata). */
function registerRow(c: CampaignT): Record<string, string> {
  return {
    created: c.createdAt,
    campaign: c.name,
    useCase: c.useCase,
    status: c.status,
    sender: c.sender.displayName,
    senderEmail: c.sender.email,
    subject: c.subject,
    preheader: c.preheader ?? '',
    intro: c.intro,
    ctaLabels: [...new Set(c.offers.map((o) => o.cta?.label).filter((l): l is string => !!l))].join('; '),
    offers: c.offers.map((o) => `${o.vehicle.make} ${o.vehicle.model} ${o.vehicle.derivative}`).join('; '),
    layout: c.layout,
    templateVersion: String(c.templateVersion),
    wordingVersion: String(c.compliance.approvedWordingVersion),
    campaignCode: c.tracking.campaignCode,
    hostedUrl: c.hostedPage.url,
    sentAt: c.sentAt ?? '',
    sentVia: c.sentVia ?? '',
  };
}

const csvCell = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV of every campaign's register row, for the FCA promotions record. */
function promotionsCsv(campaigns: CampaignT[]): string {
  const header = REGISTER_FIELDS.map(([, label]) => csvCell(label)).join(',');
  const rows = campaigns.map((c) => {
    const r = registerRow(c);
    return REGISTER_FIELDS.map(([key]) => csvCell(r[key] ?? '')).join(',');
  });
  return [header, ...rows].join('\r\n') + '\r\n';
}

// ---------- build ----------

function buildCampaign(input: DraftCampaign, template: TemplateT, createdBy: string, base: string): CampaignT {
  const variant = input.offers[0]!.contractType;
  const nowIso = new Date().toISOString();
  const slug = newSlug();
  const draft = {
    id: newId(),
    name: input.name,
    useCase: input.useCase,
    templateId: template.id,
    templateVersion: template.version,
    subject: input.subject,
    ...(input.preheader ? { preheader: input.preheader } : {}),
    intro: input.intro,
    layout: input.layout,
    offers: input.offers,
    ...(input.recipient ? { recipient: input.recipient } : {}),
    sender: input.sender,
    compliance: { variant, approvedWordingVersion: template.version },
    hostedPage: { slug, url: `${base}/c/${slug}`, enabled: true },
    tracking: { campaignCode: newCampaignCode(), utm: {} },
    status: 'draft' as const,
    createdBy,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  return Campaign.parse(draft);
}

// ---------- assemble (shared by preview and create) ----------

class AssembleError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 422,
  ) {
    super(message);
  }
}

/** Validate the template, resolve any included brochures, build the Campaign and render it. No I/O writes. */
async function assemble(env: Env, input: DraftCampaign, createdBy: string): Promise<{ campaign: CampaignT; rendered: ReturnType<typeof render> }> {
  if (!input.offers.every((o) => o.contractType === input.offers[0]!.contractType)) {
    throw new AssembleError('All offers in one campaign must be the same contract type.', 422);
  }
  // The rep's saved portrait is authoritative for a user sender: inject it (and drop any client-supplied
  // headshot), so it shows on every email and can't be spoofed with someone else's photo.
  if (input.sender.kind === 'user') {
    const saved = await sendersRepo(env).get(input.sender.email);
    const { headshotUrl: _clientHeadshot, ...senderNoHeadshot } = input.sender;
    input.sender = saved?.headshotUrl ? { ...senderNoHeadshot, headshotUrl: saved.headshotUrl } : senderNoHeadshot;
  }
  const templates = templatesRepo(env);
  const template = input.templateId ? await templates.getById(input.templateId) : await templates.approvedDefault();
  if (!template) throw new AssembleError('That template does not exist.', 404);
  if (template.status !== 'approved') throw new AssembleError('That template is not approved.', 422);

  // Resolve the brochure record for any offer whose "include brochure" toggle is on; render() needs it.
  const brochureRepo = d1BrochureRepo(env);
  const brochures: Record<string, Brochure> = {};
  for (const o of input.offers) {
    if (!o.brochure?.include) continue;
    const b = await brochureRepo.findById(o.brochure.brochureId);
    if (!b) throw new AssembleError('The brochure for one of the offers no longer exists. Re-attach it.', 422);
    brochures[b.id] = b;
  }

  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  try {
    const campaign = buildCampaign(input, template, createdBy, base);
    const rendered = render(campaign, template, { publicBaseUrl: base, brochures });
    return { campaign, rendered };
  } catch (err) {
    throw new AssembleError(err instanceof Error ? err.message : 'The campaign could not be rendered.', 422);
  }
}

/** Parse and validate the request body as a draft campaign, or throw AssembleError. */
async function readDraft(c: { req: { json(): Promise<unknown> } }): Promise<DraftCampaign> {
  const raw = await c.req.json().catch(() => undefined);
  if (raw === undefined) throw new AssembleError('Send a JSON campaign.', 400);
  const parsed = DraftCampaign.safeParse(raw);
  if (!parsed.success) throw new AssembleError(`That campaign is not valid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, 422);
  return parsed.data;
}

// ---------- tool API (behind Access) ----------

export const campaignsApi = new Hono<AppEnv>();

/** Render a draft for the live preview without persisting anything. */
campaignsApi.post('/campaigns/preview', async (c) => {
  try {
    const input = await readDraft(c);
    const { rendered } = await assemble(c.env, input, c.get('user').email);
    return c.json({ html: rendered.html, hostedHtml: rendered.hostedHtml, layout: rendered.layout });
  } catch (err) {
    if (err instanceof AssembleError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

campaignsApi.post('/campaigns', async (c) => {
  let campaign: CampaignT;
  let rendered: ReturnType<typeof render>;
  try {
    const input = await readDraft(c);
    ({ campaign, rendered } = await assemble(c.env, input, c.get('user').email));
  } catch (err) {
    if (err instanceof AssembleError) return c.json({ error: err.message }, err.status);
    throw err;
  }
  await writeHostedPage(c.env.HOSTED, campaign, rendered.hostedHtml);
  await campaignsRepo(c.env).save(campaign, rendered.links);
  // html/text carry working /r links (the campaign is now stored) for Copy-for-Outlook.
  return c.json({ campaign, hostedUrl: campaign.hostedPage.url, layout: rendered.layout, html: rendered.html, text: rendered.text }, 201);
});

campaignsApi.get('/campaigns', async (c) => {
  const list = await campaignsRepo(c.env).listByUser(c.get('user').email);
  return c.json({ campaigns: list });
});

campaignsApi.get('/campaigns/:id', async (c) => {
  const campaign = await campaignsRepo(c.env).get(c.req.param('id'));
  return campaign ? c.json({ campaign }) : c.json({ error: 'Campaign not found.' }, 404);
});

campaignsApi.get('/campaigns/:id/stats', async (c) => {
  const id = c.req.param('id');
  if (!(await campaignsRepo(c.env).get(id))) return c.json({ error: 'Campaign not found.' }, 404);
  const rows = await db(c.env.DB).select().from(clicksTable).where(eq(clicksTable.campaignId, id)).all();
  const real = rows.filter((r) => r.uaClass !== 'scanner');
  const byLink = new Map<string, number>();
  let views = 0;
  let clicks = 0;
  for (const r of real) {
    if (r.kind === 'view') views += 1;
    else {
      clicks += 1;
      byLink.set(r.linkId, (byLink.get(r.linkId) ?? 0) + 1);
    }
  }
  const ts = real.map((r) => r.ts).sort();
  const last = (kind: 'click' | 'view') => {
    const t = real.filter((r) => r.kind === kind).map((r) => r.ts).sort();
    return t[t.length - 1] ?? null;
  };
  return c.json({
    clicks,
    views,
    byLink: [...byLink.entries()].map(([linkId, count]) => ({ linkId, count })).sort((a, b) => b.count - a.count),
    scannerHits: rows.length - real.length,
    firstActivity: ts[0] ?? null,
    lastActivity: ts[ts.length - 1] ?? null,
    lastClick: last('click'),
    lastView: last('view'),
  });
});

/** The promotions register (brief §5.5): every campaign's rep-authored copy and metadata. */
campaignsApi.get('/register', async (c) => {
  const campaigns = await campaignsRepo(c.env).listAll();
  return c.json({ columns: REGISTER_FIELDS.map(([key, label]) => ({ key, label })), rows: campaigns.map(registerRow) });
});

campaignsApi.get('/register.csv', async (c) => {
  const campaigns = await campaignsRepo(c.env).listAll();
  return new Response(promotionsCsv(campaigns), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="dreamlease-promotions-register.csv"' },
  });
});

// ---------- public redirect (brief §5.6) ----------

export const redirect = new Hono<AppEnv>();

redirect.get('/r/:slug/:link', async (c) => {
  const { slug, link } = c.req.param();
  const found = await campaignsRepo(c.env).linksForSlug(slug);
  const dest = found?.links[link];
  if (!found || !dest) return c.text('Link not found.', 404);
  await logHit(c.env, found.id, link, 'click', c.req.header('user-agent') ?? '');
  return c.redirect(dest, 302);
});
