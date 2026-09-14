/**
 * render(campaign, template) → Rendered — brief §4, §5.2, §5.4, §5.5.
 * Pure: no I/O, no clock unless passed in. The only place email or hosted HTML is produced.
 */
import type { Brochure, Campaign, ComplianceBlock, Rendered, Template, TemplateLayout } from '@offer-mailer/schema';
import { assertNoCapId } from '@offer-mailer/schema';
import { compactCard, ghostGrid, halfCard, heroCard, rowCard } from './cards.js';
import { C, FONT, LH, esc, paragraphs } from './html.js';
import { COMPACT_CELL, EMAIL_WIDTH, GRID_PAD, HALF_CELL, SIDE } from './layout.js';
import { Links } from './links.js';
import { RenderError, buildCards, type CardVM } from './viewmodel.js';

export { RenderError };

/** Bump when the markup changes in a way Emma should re-approve. */
export const MARKUP_VERSION = 1;

export class TemplateNotApprovedError extends Error {
  constructor(template: Template) {
    super(`template "${template.name}" v${template.version} is ${template.status}, not approved`);
    this.name = 'TemplateNotApprovedError';
  }
}

export interface RenderOptions {
  /** Origin that serves /r, /c, /b and /a, e.g. https://offers.dreamlease.co.uk */
  publicBaseUrl: string;
  /** Brochure records referenced by the campaign's offers, keyed by id. */
  brochures?: Record<string, Brochure>;
}

/**
 * auto: 1 → single, 2 → grid2, 3 → stack (full-width rows read better than three narrow cards),
 * 4+ → grid2. grid3 is only used when chosen explicitly; the first client review found it small.
 */
export function resolveLayout(layout: Campaign['layout'], offerCount: number): TemplateLayout {
  if (layout !== 'auto') return layout;
  if (offerCount === 1) return 'single';
  if (offerCount === 3) return 'stack';
  return 'grid2';
}

export function render(campaign: Campaign, template: Template, opts: RenderOptions): Rendered {
  if (template.status !== 'approved') throw new TemplateNotApprovedError(template);
  if (template.markupVersion !== MARKUP_VERSION) {
    throw new RenderError(`template "${template.name}" was approved against markup v${template.markupVersion}, renderer is v${MARKUP_VERSION}`);
  }
  const compliance = template.complianceBlocks[campaign.compliance.variant];
  if (!compliance) throw new RenderError(`template has no compliance block for ${campaign.compliance.variant}`);
  for (const o of campaign.offers) {
    if (o.contractType !== campaign.compliance.variant) {
      throw new RenderError(`offer ${o.id} is ${o.contractType} but the campaign compliance variant is ${campaign.compliance.variant}`);
    }
  }

  const base = opts.publicBaseUrl.replace(/\/$/, '');
  const links = new Links(base, campaign.hostedPage.slug);
  const cards = buildCards(campaign, { publicBaseUrl: base, brochures: opts.brochures ?? {}, links });
  const layout = resolveLayout(campaign.layout, cards.length);
  const hostedUrl = links.track('hosted', campaign.hostedPage.url);

  const body = emailBody(campaign, template, cards, layout, compliance, { base, hostedUrl, links, forHostedPage: false });
  const hostedBody = emailBody(campaign, template, cards, layout, compliance, { base, hostedUrl, links, forHostedPage: true });

  const rendered: Rendered = {
    subject: campaign.subject,
    html: emailDocument(campaign, body),
    hostedHtml: hostedDocument(campaign, hostedBody),
    text: plainText(campaign, template, cards, compliance, hostedUrl),
    layout,
    links: links.map,
  };
  assertNoCapId(rendered, 'rendered campaign');
  return rendered;
}

// ---------- document shells ----------

const STYLE = `body{margin:0;padding:0;background:${C.ground}}table{border-collapse:collapse}img{border:0;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}a{color:${C.red}}a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important}@media (max-width:480px){.card-cell{max-width:100% !important}}`;

function emailDocument(campaign: Campaign, body: string): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" lang="en-GB">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(campaign.subject)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><style>v\\:* { behavior: url(#default#VML); display: inline-block; }</style><![endif]-->
<style>${STYLE}</style>
</head>
<body style="margin:0;padding:0;background:${C.ground}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${C.ground}" style="background:${C.ground}"><tbody><tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${EMAIL_WIDTH}"><tr><td><![endif]-->
${body}
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></tbody></table>
</body>
</html>`;
}

function hostedDocument(campaign: Campaign, body: string): string {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(campaign.subject)} · DreamLease</title>
<style>${STYLE}body{font-family:${FONT}}</style>
</head>
<body>
<div style="padding:32px 12px">
${body}
</div>
</body>
</html>`;
}

// ---------- email body ----------

interface BodyCtx {
  base: string;
  hostedUrl: string;
  links: Links;
  forHostedPage: boolean;
}

function emailBody(campaign: Campaign, template: Template, cards: CardVM[], layout: TemplateLayout, compliance: ComplianceBlock, ctx: BodyCtx): string {
  const preheader = campaign.preheader
    ? `<tr><td style="padding:0"><div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${esc(campaign.preheader)}${'&nbsp;&zwnj;'.repeat(30)}</div></td></tr>`
    : '';

  const viewOnline = ctx.forHostedPage
    ? ''
    : `<tr><td align="right" style="font-size:12px;line-height:16px;${LH};color:${C.graphite};padding-bottom:14px"><a href="${esc(ctx.hostedUrl)}" style="color:${C.red};text-decoration:underline">View these offers online</a></td></tr>`;

  const header = `<tr><td style="padding:20px 24px 0 24px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tbody>${viewOnline}<tr><td style="padding-bottom:20px;border-bottom:1px solid ${C.border}"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tbody><tr><td style="background:${C.white};padding:2px 4px 2px 0"><img src="${esc(ctx.base)}/a/logo-2x.png" width="98" height="32" alt="DreamLease" style="display:block;border:0;width:98px;height:32px"></td></tr></tbody></table></td></tr></tbody></table></td></tr>`;

  const greeting = campaign.recipient?.firstName ? `<p style="margin:0 0 14px 0;font-size:22px;line-height:28px;${LH};font-weight:700;color:${C.black}">Hi ${esc(campaign.recipient.firstName)},</p>` : '';
  const intro = `<tr><td style="padding:28px 24px 8px 24px">${greeting}${paragraphs(campaign.intro, `margin:0 0 14px 0;font-size:16px;line-height:26px;${LH};color:${C.graphite}`)}</td></tr>`;

  let offersHtml: string;
  switch (layout) {
    case 'single':
      offersHtml = `<tr><td style="padding:12px ${SIDE}px 8px ${SIDE}px">${cards.map(heroCard).join('')}</td></tr>`;
      break;
    case 'stack':
      offersHtml = `<tr><td style="padding:12px ${SIDE}px 8px ${SIDE}px">${cards.map(rowCard).join('')}</td></tr>`;
      break;
    case 'grid2':
      offersHtml = `<tr><td style="padding:12px ${GRID_PAD}px 8px ${GRID_PAD}px;font-size:0;text-align:center">${ghostGrid(cards.map(halfCard), 2, HALF_CELL)}</td></tr>`;
      break;
    case 'grid3': {
      const feeParts = ['All offers: processing fee £299.99 inc VAT.'];
      if (cards.some((c) => c.brochure)) feeParts.push("Brochure figures are the manufacturer's and may differ from this offer.");
      offersHtml = `<tr><td style="padding:12px ${GRID_PAD}px 0 ${GRID_PAD}px;font-size:0;text-align:center">${ghostGrid(cards.map(compactCard), 3, COMPACT_CELL)}</td></tr><tr><td style="padding:0 ${SIDE}px 8px ${SIDE}px"><p style="margin:0;font-size:11px;line-height:16px;${LH};color:${C.graphite}">${esc(feeParts.join(' '))}</p></td></tr>`;
      break;
    }
  }

  const s = campaign.sender;
  const sigEmail = ctx.links.track('sig-email', `mailto:${s.email}`);
  const signature = `<tr><td style="padding:8px 24px 28px 24px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;border-top:1px solid ${C.border}"><tbody><tr><td style="padding:22px 0 0 0;vertical-align:top"><p style="margin:0 0 2px 0;font-size:16px;line-height:22px;${LH};font-weight:700;color:${C.black}">${esc(s.displayName)}</p>${s.jobTitle ? `<p style="margin:0 0 8px 0;font-size:14px;line-height:20px;${LH};color:${C.graphite}">${esc(s.jobTitle)}</p>` : ''}<p style="margin:0;font-size:14px;line-height:22px;${LH};color:${C.graphite}">${s.phone ? `${esc(s.phone)}<br>` : ''}<a href="${esc(sigEmail)}" style="color:${C.red};text-decoration:underline">${esc(s.email)}</a></p></td></tr></tbody></table></td></tr>`;

  const siteHref = ctx.links.track('footer-site', 'https://www.dreamlease.co.uk');
  const footer = `<tr><td style="padding:0 24px 24px 24px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-radius:12px"><tbody><tr><td style="background:${C.panel};border-radius:12px;padding:20px 20px 18px 20px"><p style="margin:0 0 10px 0;font-size:11px;line-height:14px;${LH};font-weight:700;letter-spacing:1px;color:${C.ink}">${esc(compliance.title.toUpperCase())}</p>${compliance.paragraphs.map((p) => `<p style="margin:0 0 8px 0;font-size:12px;line-height:18px;${LH};color:${C.graphite}">${esc(p)}</p>`).join('')}<p style="margin:12px 0 0 0;padding-top:12px;border-top:1px solid ${C.border};font-size:12px;line-height:18px;${LH};color:${C.graphite}">${esc(template.footer.optOutLine)}</p><p style="margin:8px 0 0 0;font-size:11px;line-height:16px;${LH};color:${C.graphite}">${esc(template.footer.companyLine)} <a href="${esc(siteHref)}" style="color:${C.graphite};text-decoration:underline">dreamlease.co.uk</a></p></td></tr></tbody></table></td></tr>`;

  // Fluid container: 100% up to EMAIL_WIDTH so phones reflow instead of scaling the email down.
  // Outlook desktop gets the fixed width from the ghost table in emailDocument().
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="100%" style="margin:0 auto;border-collapse:collapse;background:${C.white};width:100%;max-width:${EMAIL_WIDTH}px;font-family:${FONT};color:${C.graphite}"><tbody>${preheader}${header}${intro}${offersHtml}${signature}${footer}</tbody></table>`;
}

// ---------- plain text alternative ----------

function plainText(campaign: Campaign, template: Template, cards: CardVM[], compliance: ComplianceBlock, hostedUrl: string): string {
  const lines: string[] = [];
  if (campaign.recipient?.firstName) lines.push(`Hi ${campaign.recipient.firstName},`, '');
  lines.push(campaign.intro.trim(), '', `View these offers online: ${hostedUrl}`, '');
  for (const c of cards) {
    lines.push(`${c.make} ${c.model} — ${c.derivative}`);
    lines.push(c.isSalsac ? `${c.net20} per month net (20% taxpayer) · ${c.net40} per month net (40% taxpayer)` : `${c.price} ${c.vatLabel}`);
    lines.push(c.specLine);
    if (c.stats.length) lines.push(c.stats.map((s) => `${s.label}: ${s.value}`).join(' · '));
    lines.push(`${c.cta.label}: ${c.cta.href}`);
    if (c.viewHref) lines.push(`View this offer: ${c.viewHref}`);
    if (c.brochure) lines.push(`${c.brochure.label}: ${c.brochure.href}`);
    lines.push(c.smallPrint, '');
  }
  const s = campaign.sender;
  lines.push(s.displayName, ...(s.jobTitle ? [s.jobTitle] : []), ...(s.phone ? [s.phone] : []), s.email, '');
  lines.push(compliance.title.toUpperCase(), ...compliance.paragraphs, '', template.footer.optOutLine, template.footer.companyLine, 'https://www.dreamlease.co.uk');
  return lines.join('\n');
}
