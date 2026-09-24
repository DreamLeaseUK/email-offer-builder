import { describe, expect, it } from 'vitest';
import app from '../src/index.js';
import type { Env } from '../src/env.js';
import { OPERATIONS, buildOpenApi } from '../src/openapi.js';

const baseEnv = {
  ACCESS_TEAM_DOMAIN: '',
  ACCESS_AUD: '',
  PUBLIC_BASE_URL: 'https://offers.dreamlease.co.uk',
  TOOL_BASE_URL: 'https://mailer.dreamlease.co.uk',
  APP_VERSION: 'test',
} as unknown as Env;
const devEnv = { ...baseEnv, DEV_USER_EMAIL: 'matt.wilson@dreamlease.co.uk' } as unknown as Env;

type Doc = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, { operationId: string; security?: unknown[]; requestBody?: { content: Record<string, { schema: unknown }> } }>>;
  components: { schemas: Record<string, unknown> };
};

/** Every route the Hono app actually serves, as "method /openapi/{path}". Middleware (method ALL) is not a route. */
function servedRoutes(): string[] {
  const seen = new Set<string>();
  for (const r of app.routes) {
    if (r.method === 'ALL') continue;
    seen.add(`${r.method.toLowerCase()} ${r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`);
  }
  return [...seen].sort();
}

describe('OpenAPI document', () => {
  it('documents every route the app serves, and nothing it does not (drift guard)', () => {
    const documented = OPERATIONS.map((o) => `${o.method} ${o.path}`).sort();
    const served = servedRoutes();
    expect(served.filter((r) => !documented.includes(r)), 'served but undocumented: add them to src/openapi.ts').toEqual([]);
    expect(documented.filter((r) => !served.includes(r)), 'documented but not served: remove them from src/openapi.ts').toEqual([]);
  });

  it('is a valid OpenAPI 3.1 shape with unique operation ids', () => {
    const doc = buildOpenApi('test') as Doc;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe('test');
    const ids = Object.values(doc.paths).flatMap((ops) => Object.values(ops).map((op) => op.operationId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(OPERATIONS.length);
  });

  it('takes request bodies from the Zod data model', () => {
    const doc = buildOpenApi('test') as Doc;
    for (const name of ['DraftCampaign', 'Offer', 'TemplateBody', 'SuppressionAdd']) expect(doc.components.schemas).toHaveProperty(name);
    const create = doc.paths['/api/campaigns']?.post;
    expect(create?.requestBody?.content['application/json']?.schema).toEqual({ $ref: '#/components/schemas/DraftCampaign' });
  });

  it('marks public routes as public and the tool API as behind Cloudflare Access', () => {
    const doc = buildOpenApi('test') as Doc;
    expect(doc.paths['/health']?.get?.security).toEqual([]);
    expect(doc.paths['/c/{slug}']?.get?.security).toEqual([]);
    expect(doc.paths['/api/campaigns']?.get?.security).toEqual([{ cloudflareAccess: [] }]);
  });

  it('never carries a CAP ID or the source image host (house rule 2)', () => {
    const text = JSON.stringify(buildOpenApi('test'));
    expect(text).not.toMatch(/capid/i);
    expect(text).not.toMatch(/motorleaseplatform/i);
  });
});

describe('GET /api/openapi.json', () => {
  it('is behind Access like the rest of /api (fails closed without a user)', async () => {
    const res = await app.request('/api/openapi.json', {}, baseEnv);
    expect(res.status).toBe(503);
  });

  it('serves the document to a signed-in user, versioned with the app', async () => {
    const res = await app.request('/api/openapi.json', {}, devEnv);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Doc;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe('test');
    expect(doc.paths).toHaveProperty('/api/openapi.json');
  });
});
