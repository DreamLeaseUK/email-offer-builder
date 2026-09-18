/**
 * D1 schema (Drizzle). Domain objects are stored as JSON snapshots validated by @offer-mailer/schema,
 * with the columns we query or index pulled out alongside. That keeps migrations rare while the brief
 * is still moving, and guarantees what was sent never changes when the library does.
 *
 * Nothing in here may ever hold a CAP ID or a source image URL. See packages/schema/src/capid.ts.
 */
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const campaigns = sqliteTable(
  'campaigns',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    useCase: text('use_case').notNull(),
    status: text('status').notNull(),
    hostedSlug: text('hosted_slug').notNull(),
    templateId: text('template_id').notNull(),
    templateVersion: integer('template_version').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    sentAt: text('sent_at'),
    sentVia: text('sent_via'),
    /** linkId -> destination, from render(). The /r/<slug>/<linkId> redirect resolves against this. */
    links: text('links', { mode: 'json' }).notNull().default(sql`'{}'`),
    /** Campaign JSON snapshot (validated by Campaign schema) */
    data: text('data', { mode: 'json' }).notNull(),
  },
  (t) => [
    uniqueIndex('campaigns_hosted_slug').on(t.hostedSlug),
    index('campaigns_created_by').on(t.createdBy),
    index('campaigns_status').on(t.status),
  ],
);

export const offers = sqliteTable(
  'offers',
  {
    id: text('id').primaryKey(),
    vehicleKey: text('vehicle_key').notNull(),
    contractType: text('contract_type').notNull(),
    validUntil: text('valid_until').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    /** Offer JSON (validated by Offer schema) */
    data: text('data', { mode: 'json' }).notNull(),
  },
  (t) => [index('offers_vehicle_key').on(t.vehicleKey), index('offers_valid_until').on(t.validUntil)],
);

export const templates = sqliteTable(
  'templates',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull(),
    approvedBy: text('approved_by'),
    approvedAt: text('approved_at'),
    createdAt: text('created_at').notNull(),
    /** Template JSON (validated by Template schema): markupVersion, complianceBlocks, footer */
    data: text('data', { mode: 'json' }).notNull(),
  },
  (t) => [uniqueIndex('templates_name_version').on(t.name, t.version), index('templates_status').on(t.status)],
);

export const brochures = sqliteTable(
  'brochures',
  {
    id: text('id').primaryKey(),
    vehicleKey: text('vehicle_key').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    /** Brochure JSON */
    data: text('data', { mode: 'json' }).notNull(),
  },
  (t) => [index('brochures_vehicle_key_status').on(t.vehicleKey, t.status)],
);

/**
 * The latest completed brochure search per vehicle: what was checked and why something did or did not
 * attach. It lets a "nothing found" answer be remembered for a few days and shown to the rep. A search that
 * failed to run is never written here.
 */
export const brochureSearches = sqliteTable('brochure_searches', {
  vehicleKey: text('vehicle_key').primaryKey(),
  status: text('status').notNull(),
  searchedAt: text('searched_at').notNull(),
  /** BrochureSearch JSON */
  data: text('data', { mode: 'json' }).notNull(),
});

export const senders = sqliteTable('senders', {
  /** user email for kind=user, mailbox address for kind=shared */
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  updatedAt: text('updated_at').notNull(),
  /** Sender JSON */
  data: text('data', { mode: 'json' }).notNull(),
});

/** Click and hosted-view log. No IP, no full user agent. */
export const clicks = sqliteTable(
  'clicks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    campaignId: text('campaign_id').notNull(),
    /** 'view' for hosted page views, otherwise the link id */
    linkId: text('link_id').notNull(),
    /** 'click' | 'view' */
    kind: text('kind').notNull(),
    /** coarse: 'desktop' | 'mobile' | 'scanner' | 'other' */
    uaClass: text('ua_class').notNull(),
    ts: text('ts').notNull(),
  },
  (t) => [index('clicks_campaign_ts').on(t.campaignId, t.ts)],
);

export const suppressions = sqliteTable('suppressions', {
  email: text('email').primaryKey(),
  addedBy: text('added_by').notNull(),
  addedAt: text('added_at').notNull(),
  note: text('note'),
});

/** 24-hour lookup cache: the parsed lookup result (Offer plus the site's configuration options), never HTML. */
export const lookupCache = sqliteTable('lookup_cache', {
  urlKey: text('url_key').primaryKey(),
  fetchedAt: text('fetched_at').notNull(),
  data: text('data', { mode: 'json' }).notNull(),
});
