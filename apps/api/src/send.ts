/**
 * Send (Phase 1, docs/evolution.md §6; CLAUDE.md rule 4 as built): the salesperson presses Send and the email goes
 * from their own mailbox through Microsoft 365, after the automatic checks pass. Never automatically, never in bulk:
 * one campaign, one customer, one send.
 *
 *   POST /api/campaigns/:id/checks { to? }             run the checks (Copy for Outlook runs them too, without `to`)
 *   POST /api/campaigns/:id/send   { to, firstName? }  run the checks, then send as the signed-in salesperson
 *
 * Only the person who created the campaign can check or send it, and only if its signature is theirs. The email is
 * rebuilt on the server (renderForSend), never taken from the browser. The customer's address is used for the one
 * send and never stored or logged (the register records who sent it and when).
 */
import { LookupError, PRICING_VERSION } from '@offer-mailer/adapters';
import type { Campaign, Offer, Rendered } from '@offer-mailer/schema';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { finderHttp } from './brochures.js';
import { campaignsRepo, renderForSend } from './campaigns.js';
import type { AppEnv, Env } from './env.js';
import { urlSource } from './lookup.js';
import { MAIL_RULES, OutlookUnavailable, mailConnectionsRepo, mailSetup, maySend, sendAs } from './mail.js';
import type { Check, OfferRecheck, PreSendDeps } from './presend.js';
import { allPassed, runPreSendChecks } from './presend.js';
import { complianceApprovers } from './roles.js';
import { safeErrorLine } from './safe-log.js';
import { suppressionsRepo } from './suppressions.js';

/** POST /campaigns/:id/checks body. The address is optional: Copy for Outlook checks without one. */
export const SendChecksBody = z.object({ to: z.string().max(254).optional() });
/** POST /campaigns/:id/send body. `to` is checked by the recipient check (a bad address is a failed check, not a 422). */
export const SendBody = z.object({ to: z.string().max(254), firstName: z.string().trim().max(60).optional() });

/**
 * While the tool runs on the local sign-in bypass (no Access: the two local dev scripts, which may be shared through
 * a tunnel), sending is allowed only from a page on this PC: anyone else holding a tunnel link would otherwise send
 * from the dev user's real mailbox. Browsers always send Origin on a POST.
 */
const LOCAL_PAGE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const OFFER_ENDED = 'This offer is no longer on the website';

/** The real outside answers for the checks: the website, our buckets, other people's pages, the suppression list. */
export function preSendDeps(env: Env, now = new Date()): PreSendDeps {
  return {
    now,
    approvers: complianceApprovers(env),
    maxEmailBytes: MAIL_RULES.maxEmailBytes,
    offerCheckedMs: MAIL_RULES.offerCheckedMs,
    pricingVersion: PRICING_VERSION,
    async recheckOffer(o: Offer): Promise<OfferRecheck> {
      try {
        const r = await urlSource(env).lookupFull({ url: o.offerUrl, createdBy: o.createdBy });
        return { ok: true, ...(r.offer.contractType === o.contractType ? { monthly: r.offer.pricing.monthly } : {}) };
      } catch (err) {
        if (err instanceof LookupError && err.message.startsWith(OFFER_ENDED)) return { ok: false, problem: 'the offer has ended on the website. Remove it, or add a current offer.' };
        return { ok: false, problem: 'it could not be checked on the website just now. Try again in a minute.' };
      }
    },
    async storedFileExists(key: string): Promise<boolean> {
      const bucket = key.startsWith('brochures/') ? env.BROCHURES : env.IMAGES;
      return !!(await bucket.head(key));
    },
    async linkGone(url: string): Promise<boolean> {
      const res = await finderHttp(url);
      return !!res && (res.status === 404 || res.status === 410);
    },
    isSuppressed: (email: string) => suppressionsRepo(env).isSuppressed(email),
  };
}

type Loaded = { campaign: Campaign } | { error: string; status: 400 | 403 | 404 | 422 };

async function loadOwn(c: Context<AppEnv>): Promise<Loaded> {
  const campaign = await campaignsRepo(c.env).get(c.req.param('id') ?? '');
  if (!campaign) return { error: 'Campaign not found.', status: 404 };
  const me = c.get('user').email.toLowerCase();
  if (campaign.createdBy.toLowerCase() !== me) return { error: 'Only the person who created this campaign can send it.', status: 403 };
  if (campaign.sender.kind !== 'user' || campaign.sender.email.toLowerCase() !== me) return { error: 'The signature on this campaign is not yours. Create it again with your own details.', status: 403 };
  return { campaign };
}

async function checksFor(env: Env, campaign: Campaign, to: string | undefined, firstName?: string): Promise<{ checks: Check[]; rendered?: Rendered }> {
  const built = await renderForSend(env, campaign, firstName);
  const checks = await runPreSendChecks(
    {
      campaign,
      template: built.template,
      rendered: built.rendered,
      ...(built.renderError ? { renderError: built.renderError } : {}),
      brochures: built.brochures,
      storedLinkIds: await campaignsRepo(env).linkIds(campaign.id),
      ...(to !== undefined ? { to } : {}),
    },
    preSendDeps(env),
  );
  return { checks, ...(built.rendered ? { rendered: built.rendered } : {}) };
}

const failedSummary = (checks: Check[]): string => {
  const failed = checks.filter((x) => !x.ok);
  return `Not sent. ${failed.length === 1 ? 'One check' : `${failed.length} checks`} failed: ${failed.flatMap((x) => x.problems).join(' ')}`;
};

export const sendApi = new Hono<AppEnv>();

sendApi.post('/campaigns/:id/checks', async (c) => {
  const body = SendChecksBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: 'Send JSON, optionally with the customer\'s address as "to".' }, 422);
  const loaded = await loadOwn(c);
  if ('error' in loaded) return c.json({ error: loaded.error }, loaded.status);
  const { checks } = await checksFor(c.env, loaded.campaign, body.data.to);
  return c.json({ ok: allPassed(checks), checks });
});

sendApi.post('/campaigns/:id/send', async (c) => {
  if (!c.env.ACCESS_AUD && !LOCAL_PAGE.test(c.req.header('origin') ?? '')) {
    return c.json({ error: 'Without sign-in (local development), send only from the tool on this PC (localhost).' }, 403);
  }
  const body = SendBody.safeParse(await c.req.json().catch(() => undefined));
  if (!body.success) return c.json({ error: 'Send JSON with the customer\'s address as "to".' }, 422);
  const loaded = await loadOwn(c);
  if ('error' in loaded) return c.json({ error: loaded.error }, loaded.status);
  const { campaign } = loaded;
  const email = c.get('user').email;
  if (campaign.sentAt && campaign.status === 'sent') return c.json({ error: 'This campaign has already been sent. Create a new one for another customer.', sentAt: campaign.sentAt }, 409);

  // Can this person send at all? Cheap, and said before the checks so nobody fixes an email they then cannot send.
  if (!(await mailSetup(c.env))) return c.json({ error: 'Sending from the tool is not set up yet. Use Copy for Outlook.', code: 'not_configured' }, 503);
  if (!maySend(email)) return c.json({ error: 'Sending from the tool is not available for your account yet. Use Copy for Outlook.', code: 'not_allowed' }, 403);
  if (!(await mailConnectionsRepo(c.env).get(email))) return c.json({ error: 'Connect Outlook first (step 3), then press Send.', code: 'connect' }, 428);

  const { checks, rendered } = await checksFor(c.env, campaign, body.data.to, body.data.firstName);
  if (!allPassed(checks) || !rendered) return c.json({ error: failedSummary(checks), checks }, 422);

  const repo = campaignsRepo(c.env);
  const claimedAt = new Date().toISOString();
  if (!(await repo.claimSend(campaign.id, claimedAt))) {
    return c.json({ error: 'This campaign has been sent, or may have been: look in your Outlook Sent Items. To send these offers again, create the campaign again.' }, 409);
  }
  let deliveredAt: string;
  try {
    ({ deliveredAt } = await sendAs(c.env, email, {
      rendered,
      campaign,
      sender: campaign.sender,
      to: { address: body.data.to.trim() },
    }));
  } catch (err) {
    // Microsoft may have the email: keep the reservation, so nothing can send it a second time.
    if (err instanceof OutlookUnavailable && err.mayHaveSent) return c.json({ error: err.message, code: err.code }, 502);
    // Certainly not sent (sendAs failed before the send itself): the campaign can be sent again.
    await repo.releaseSend(campaign.id, claimedAt, campaign.status);
    if (err instanceof OutlookUnavailable) {
      const status = err.code === 'connect' || err.code === 'reconnect' ? 428 : err.code === 'throttled' ? 429 : err.code === 'rejected' || err.code === 'unavailable' ? 502 : 503;
      if (err.retryAfterSeconds) c.header('retry-after', String(err.retryAfterSeconds));
      return c.json({ error: err.message, code: err.code }, status);
    }
    throw err;
  }
  // Sent. Record it; a failure here must not look like a failed send (the reservation already blocks a second one).
  let sent: Campaign | undefined;
  for (let attempt = 0; attempt < 2 && !sent; attempt++) {
    try {
      sent = await repo.markSent(campaign, deliveredAt, email);
    } catch (err) {
      if (attempt === 1) console.error('send recorded late:', campaign.id, safeErrorLine(err));
    }
  }
  return c.json({ sentAt: deliveredAt, sentVia: 'm365', ...(sent ? { campaign: sent } : { recordPending: true }), checks });
});
