/**
 * Dev preview — renders the fixture campaigns so the template can be checked in real clients
 * before the editor exists (brief §8.2 step 2). Behind Access like the rest of /api, and LOCAL ONLY (Matt, 24 Sept
 * 2026): on the live site it answers 404, so a crafted link can't publish a fixture page (made-up prices, no
 * approved template) to the public offers domain.
 *
 *   /api/dev/preview?layout=stack&count=4&contract=personal&cta=book&brochure=pdf&sender=salesperson&format=html
 *   format: html (default) | hosted | text | eml | json
 *   publish=1 also writes the hosted page to R2 so /c/<slug> serves it.
 */
import type { CtaKind } from '@offer-mailer/schema';
import { render, toEml } from '@offer-mailer/render';
import { fixtureCampaign, fixtureTemplate } from '@offer-mailer/render/fixtures';
import type { FixtureOptions } from '@offer-mailer/render/fixtures';
import { Hono } from 'hono';
import type { AppEnv } from './env.js';
import { writeHostedPage } from './hosted.js';
import { isThisLaptop } from './local.js';

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined =>
  allowed.includes(value as T) ? (value as T) : undefined;

export const dev = new Hono<AppEnv>();

dev.use('*', async (c, next) => (isThisLaptop(c.req.url, c.req.header('cf-connecting-ip')) ? next() : c.json({ error: 'Not found' }, 404)));

dev.get('/preview', async (c) => {
  const q = c.req.query();
  const opts: FixtureOptions = {};
  const layout = oneOf(q.layout, ['auto', 'single', 'stack'] as const);
  if (layout) opts.layout = layout;
  if (q.count) opts.offerCount = Number(q.count);
  const contract = oneOf(q.contract, ['personal', 'business', 'salary_sacrifice'] as const);
  if (contract) opts.contractType = contract;
  const cta = oneOf(q.cta, ['view_offer', 'email', 'call', 'whatsapp', 'book', 'link'] as const satisfies readonly CtaKind[]);
  if (cta) opts.cta = cta === 'link' ? { kind: 'link', url: 'https://www.dreamlease.co.uk/news/', label: q.label ?? 'Read the full review' } : q.label ? { kind: cta, label: q.label } : { kind: cta };
  const brochure = oneOf(q.brochure, ['none', 'pdf', 'gated'] as const);
  if (brochure) opts.brochure = brochure;
  const sender = oneOf(q.sender, ['salesperson', 'shared'] as const);
  if (sender) opts.sender = sender;

  const { campaign, brochures } = fixtureCampaign(opts);
  campaign.hostedPage.url = `${c.env.PUBLIC_BASE_URL}/c/${campaign.hostedPage.slug}`;
  const out = render(campaign, fixtureTemplate, { publicBaseUrl: c.env.PUBLIC_BASE_URL, brochures });

  if (q.publish === '1') await writeHostedPage(c.env.HOSTED, campaign, out.hostedHtml);

  switch (q.format) {
    case 'hosted':
      return c.html(out.hostedHtml);
    case 'text':
      return c.text(out.text);
    case 'eml':
      return new Response(toEml(campaign, out, 'Priya Example <priya@example.com>'), {
        headers: { 'content-type': 'message/rfc822', 'content-disposition': `attachment; filename="offer-mailer-${out.layout}.eml"` },
      });
    case 'json':
      return c.json({ layout: out.layout, subject: out.subject, links: out.links, hosted: campaign.hostedPage.url });
    default:
      return c.html(out.html);
  }
});
