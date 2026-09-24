/**
 * OpenAPI 3.1 description of the Worker's whole HTTP surface: the public routes (health, hosted pages, stored
 * files, email links) and the tool API behind Cloudflare Access. Served at GET /api/openapi.json so other apps,
 * Make scenarios and AI agents can use the Offer Mailer without reading its code (house rule "API-first").
 *
 * OPERATIONS is the catalogue. test/openapi.test.ts fails if the app serves a route that is not listed here, or
 * lists one it does not serve, so the document cannot drift: adding a route means adding it here.
 *
 * Request bodies validated with Zod reuse the real schemas (z.toJSONSchema over a registry, so shared models like
 * Offer become $refs). Bodies still checked by hand in their handler have a doc-only schema here and are marked
 * `x-validated-by: handler`; moving those handlers to Zod is a known follow-up (docs/architecture.md, "How to extend").
 * Responses are described, not yet typed.
 */
import { z } from 'zod';
import { Offer } from '@offer-mailer/schema';
import { DraftCampaign } from './campaigns.js';
import { SuppressionAdd, SuppressionEmail } from './suppressions.js';
import { TemplateBody } from './templates.js';

type Method = 'get' | 'post' | 'put' | 'delete';
type Access = 'public' | 'signed-in' | 'admin';
type Returns = 'json' | 'json-created' | 'html' | 'csv' | 'image' | 'pdf' | 'redirect';

export interface Operation {
  method: Method;
  /** OpenAPI path, {param} style. */
  path: string;
  tag: string;
  summary: string;
  access: Access;
  body?: { schema: string; as?: 'json' | 'multipart'; validatedBy: 'zod' | 'handler' };
  query?: Record<string, string>;
  returns: Returns;
}

// Doc-only schemas for bodies checked by hand in their handlers (validatedBy: 'handler').
const binary = () => z.string().meta({ format: 'binary' });
const LookupBody = z.object({ url: z.string().meta({ description: 'A dreamlease.co.uk offer URL.' }) });
const VehicleRef = z.object({ make: z.string(), model: z.string() });
const BrochureEnsureBody = VehicleRef.extend({ force: z.boolean().optional().meta({ description: 'Search again even if a brochure is stored (spends Firecrawl credits).' }) });
const BrochureManualForm = VehicleRef.extend({ url: z.string().optional().meta({ description: 'A link to the brochure or request page.' }), pdf: binary().optional() });
const LibrarySaveBody = z.object({ offer: Offer });
const PromoteBody = z.object({ category: z.string().max(60).meta({ description: 'The shared shelf name.' }) });
const SenderBody = z.object({
  displayName: z.string().optional(),
  jobTitle: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  bookingUrl: z.string().optional(),
  secondaryContacts: z.unknown().optional().meta({ description: 'Secondary contact methods; the result is checked against the Sender model.' }),
});
const PhotoForm = z.object({ photo: binary().meta({ description: 'A portrait image.' }) });

const registry = z.registry<{ id: string }>();
const SCHEMAS: Record<string, z.ZodType> = {
  DraftCampaign,
  Offer,
  TemplateBody,
  TemplateBodyPatch: TemplateBody.partial(),
  SuppressionAdd,
  SuppressionEmail,
  LookupBody,
  VehicleRef,
  BrochureEnsureBody,
  BrochureManualForm,
  LibrarySaveBody,
  PromoteBody,
  SenderBody,
  PhotoForm,
};
for (const [id, schema] of Object.entries(SCHEMAS)) registry.add(schema, { id });

const q = (...names: string[]) => Object.fromEntries(names.map((n) => [n, '']));

export const OPERATIONS: Operation[] = [
  // ---------- public (no login) ----------
  { method: 'get', path: '/health', tag: 'Public', summary: 'Service health: version, database, image transforms and Firecrawl configured', access: 'public', returns: 'json' },
  { method: 'get', path: '/c/{slug}', tag: 'Public', summary: "A created campaign's hosted web page (noindex; expires)", access: 'public', returns: 'html' },
  { method: 'get', path: '/f/vehicles/{file}', tag: 'Public', summary: 'A stored vehicle image (content-addressed)', access: 'public', returns: 'image' },
  { method: 'get', path: '/f/brochures/{file}', tag: 'Public', summary: 'A stored brochure PDF', access: 'public', returns: 'pdf' },
  { method: 'get', path: '/f/headshots/{file}', tag: 'Public', summary: "A salesperson's portrait", access: 'public', returns: 'image' },
  { method: 'get', path: '/b/{id}', tag: 'Public', summary: 'Brochure link used in emails: redirects to the stored PDF or the official page', access: 'public', returns: 'redirect' },
  { method: 'get', path: '/r/{slug}/{link}', tag: 'Public', summary: 'Tracked link used in emails: logs the click and redirects to the destination', access: 'public', returns: 'redirect' },

  // ---------- tool API (Cloudflare Access) ----------
  { method: 'get', path: '/api/openapi.json', tag: 'Meta', summary: 'This document', access: 'signed-in', returns: 'json' },

  { method: 'get', path: '/api/me', tag: 'Profile', summary: "The signed-in salesperson's profile, role and saved sender", access: 'signed-in', returns: 'json' },
  { method: 'post', path: '/api/me/sender', tag: 'Profile', summary: 'Save sender details shown in emails', access: 'signed-in', body: { schema: 'SenderBody', validatedBy: 'handler' }, returns: 'json' },
  { method: 'post', path: '/api/me/photo', tag: 'Profile', summary: 'Upload the portrait shown in emails and the app header', access: 'signed-in', body: { schema: 'PhotoForm', as: 'multipart', validatedBy: 'handler' }, returns: 'json' },
  { method: 'delete', path: '/api/me/photo', tag: 'Profile', summary: 'Remove the portrait', access: 'signed-in', returns: 'json' },

  { method: 'post', path: '/api/offers/lookup', tag: 'Offers', summary: 'Look up a dreamlease.co.uk offer URL: the Offer plus its term and mileage options', access: 'signed-in', body: { schema: 'LookupBody', validatedBy: 'handler' }, returns: 'json' },

  { method: 'get', path: '/api/brochures/current', tag: 'Brochures', summary: "The stored current brochure for a make and model (no search)", access: 'signed-in', query: q('make', 'model'), returns: 'json' },
  { method: 'post', path: '/api/brochures/ensure', tag: 'Brochures', summary: 'Find or reuse the brochure for a make and model; may run a metered Firecrawl search (capped at 25 credits)', access: 'signed-in', body: { schema: 'BrochureEnsureBody', validatedBy: 'handler' }, returns: 'json' },
  { method: 'post', path: '/api/brochures/accept', tag: 'Brochures', summary: "Accept the finder's offered result (e.g. the English-language European edition) and store it", access: 'signed-in', body: { schema: 'VehicleRef', validatedBy: 'handler' }, returns: 'json' },
  { method: 'post', path: '/api/brochures/manual', tag: 'Brochures', summary: 'Attach a brochure by uploading a PDF or pasting a link', access: 'signed-in', body: { schema: 'BrochureManualForm', as: 'multipart', validatedBy: 'handler' }, returns: 'json' },

  { method: 'post', path: '/api/campaigns/preview', tag: 'Campaigns', summary: 'Render a draft campaign for the live preview (nothing stored)', access: 'signed-in', body: { schema: 'DraftCampaign', validatedBy: 'zod' }, returns: 'json' },
  { method: 'post', path: '/api/campaigns', tag: 'Campaigns', summary: 'Create a campaign: stores it, writes the hosted page, returns Outlook-ready HTML and text', access: 'signed-in', body: { schema: 'DraftCampaign', validatedBy: 'zod' }, returns: 'json-created' },
  { method: 'get', path: '/api/campaigns', tag: 'Campaigns', summary: "The signed-in salesperson's campaigns", access: 'signed-in', returns: 'json' },
  { method: 'get', path: '/api/campaigns/{id}', tag: 'Campaigns', summary: 'One campaign', access: 'signed-in', returns: 'json' },
  { method: 'get', path: '/api/campaigns/{id}/stats', tag: 'Campaigns', summary: "A campaign's click statistics", access: 'signed-in', returns: 'json' },
  { method: 'get', path: '/api/register', tag: 'Register', summary: 'The promotions register: every campaign with its salesperson-authored copy', access: 'signed-in', returns: 'json' },
  { method: 'get', path: '/api/register.csv', tag: 'Register', summary: 'The promotions register as CSV', access: 'signed-in', returns: 'csv' },

  { method: 'post', path: '/api/offers/library', tag: 'Library', summary: "Save an offer to the salesperson's library", access: 'signed-in', body: { schema: 'LibrarySaveBody', validatedBy: 'zod' }, returns: 'json' },
  { method: 'get', path: '/api/library/shelves', tag: 'Library', summary: 'The shared shelves (from config/library-shelves.json)', access: 'signed-in', returns: 'json' },
  { method: 'get', path: '/api/offers/library', tag: 'Library', summary: 'Library entries: personal and shared', access: 'signed-in', returns: 'json' },
  { method: 'get', path: '/api/offers/library/archived', tag: 'Library', summary: 'Archived library entries', access: 'signed-in', returns: 'json' },
  { method: 'post', path: '/api/offers/library/{id}/reprice', tag: 'Library', summary: "Re-price an entry from the live site and re-attach the model's current brochure", access: 'signed-in', returns: 'json' },
  { method: 'post', path: '/api/offers/library/{id}/archive', tag: 'Library', summary: 'Archive an entry', access: 'signed-in', returns: 'json' },
  { method: 'post', path: '/api/offers/library/{id}/unarchive', tag: 'Library', summary: 'Restore an archived entry', access: 'signed-in', returns: 'json' },
  { method: 'post', path: '/api/offers/library/{id}/promote', tag: 'Library', summary: 'Copy an entry to a shared shelf (admin)', access: 'admin', body: { schema: 'PromoteBody', validatedBy: 'handler' }, returns: 'json' },
  { method: 'delete', path: '/api/offers/library/{id}', tag: 'Library', summary: 'Delete an entry (its owner or an admin)', access: 'signed-in', returns: 'json' },

  { method: 'get', path: '/api/templates', tag: 'Templates', summary: 'All email templates', access: 'admin', returns: 'json' },
  { method: 'get', path: '/api/templates/{id}', tag: 'Templates', summary: 'One template', access: 'admin', returns: 'json' },
  { method: 'post', path: '/api/templates', tag: 'Templates', summary: 'Create a draft template', access: 'admin', body: { schema: 'TemplateBody', validatedBy: 'zod' }, returns: 'json-created' },
  { method: 'put', path: '/api/templates/{id}', tag: 'Templates', summary: 'Edit a draft template', access: 'admin', body: { schema: 'TemplateBodyPatch', validatedBy: 'zod' }, returns: 'json' },
  { method: 'post', path: '/api/templates/{id}/publish', tag: 'Templates', summary: 'Approve a template for use (campaigns render only against approved templates)', access: 'admin', returns: 'json' },
  { method: 'post', path: '/api/templates/{id}/retire', tag: 'Templates', summary: 'Retire a template', access: 'admin', returns: 'json' },

  { method: 'post', path: '/api/suppressions', tag: 'Suppressions', summary: 'Add an opt-out to the suppression register', access: 'signed-in', body: { schema: 'SuppressionAdd', validatedBy: 'zod' }, returns: 'json-created' },
  { method: 'get', path: '/api/suppressions', tag: 'Suppressions', summary: 'The suppression register, newest first', access: 'signed-in', returns: 'json' },
  { method: 'get', path: '/api/suppressions.csv', tag: 'Suppressions', summary: 'The suppression register as CSV', access: 'signed-in', returns: 'csv' },
  { method: 'post', path: '/api/suppressions/check', tag: 'Suppressions', summary: 'Is this email suppressed? (email in the body, not the URL)', access: 'signed-in', body: { schema: 'SuppressionEmail', validatedBy: 'zod' }, returns: 'json' },
  { method: 'post', path: '/api/suppressions/remove', tag: 'Suppressions', summary: 'Remove an opt-out, re-permitting contact (admin)', access: 'admin', body: { schema: 'SuppressionEmail', validatedBy: 'zod' }, returns: 'json' },

  { method: 'get', path: '/api/dev/preview', tag: 'Dev', summary: 'Render the fixture campaigns for client testing (html, hosted, text, eml or json); publish=1 also writes the hosted page', access: 'signed-in', query: q('layout', 'count', 'contract', 'cta', 'brochure', 'sender', 'format', 'publish'), returns: 'html' },
];

const RESPONSES: Record<Returns, { code: string; description: string; content?: Record<string, { schema: object }> }> = {
  json: { code: '200', description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
  'json-created': { code: '201', description: 'Created', content: { 'application/json': { schema: { type: 'object' } } } },
  html: { code: '200', description: 'An HTML page', content: { 'text/html': { schema: { type: 'string' } } } },
  csv: { code: '200', description: 'A CSV download', content: { 'text/csv': { schema: { type: 'string' } } } },
  image: { code: '200', description: 'An image', content: { 'image/*': { schema: { type: 'string', format: 'binary' } } } },
  pdf: { code: '200', description: 'A PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
  redirect: { code: '302', description: 'Redirect to the destination' },
};

const operationId = (o: Operation) =>
  o.method + o.path.split(/[/.{}-]+/).filter((s) => s && s !== 'api').map((s) => s[0]!.toUpperCase() + s.slice(1)).join('');

export function buildOpenApi(version: string): object {
  const { schemas } = z.toJSONSchema(registry, { uri: (id) => `#/components/schemas/${id}`, io: 'input', unrepresentable: 'any' }) as {
    schemas: Record<string, Record<string, unknown>>;
  };
  // Components are addressed by their key; the generator's $schema/$id (a fragment-only URI) are not valid there.
  for (const s of Object.values(schemas)) {
    delete s.$schema;
    delete s.$id;
  }

  const paths: Record<string, Record<string, object>> = {};
  for (const o of OPERATIONS) {
    const params = [...o.path.matchAll(/\{([^}]+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    const query = Object.keys(o.query ?? {}).map((name) => ({ name, in: 'query', required: false, schema: { type: 'string' } }));
    const r = RESPONSES[o.returns];
    (paths[o.path] ??= {})[o.method] = {
      operationId: operationId(o),
      tags: [o.tag],
      summary: o.summary,
      security: o.access === 'public' ? [] : [{ cloudflareAccess: [] }],
      ...(o.access === 'admin' ? { 'x-dreamlease-role': 'master-admin' } : {}),
      ...(params.length || query.length ? { parameters: [...params, ...query] } : {}),
      ...(o.body
        ? {
            'x-validated-by': o.body.validatedBy,
            requestBody: {
              required: true,
              content: { [o.body.as === 'multipart' ? 'multipart/form-data' : 'application/json']: { schema: { $ref: `#/components/schemas/${o.body.schema}` } } },
            },
          }
        : {}),
      responses: {
        [r.code]: { description: r.description, ...(r.content ? { content: r.content } : {}) },
        default: { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'DreamLease Offer Mailer API',
      version,
      description:
        'Build branded lease-offer emails from dreamlease.co.uk offer URLs. Public routes serve hosted pages, files and email links; the tool API under /api sits behind Cloudflare Access (Microsoft Entra sign-in) and fails closed (503) until Access is configured. The Worker never sends email.',
    },
    servers: [{ url: '/' }],
    tags: [...new Set(OPERATIONS.map((o) => o.tag))].map((name) => ({ name })),
    paths,
    components: {
      schemas,
      securitySchemes: {
        cloudflareAccess: {
          type: 'apiKey',
          in: 'header',
          name: 'Cf-Access-Jwt-Assertion',
          description: 'Set by Cloudflare Access after sign-in. Routes marked x-dreamlease-role: master-admin also need a master admin (config/admins.json).',
        },
      },
    },
  };
}
