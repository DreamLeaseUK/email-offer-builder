/**
 * render(campaign, template) → Rendered — brief §4, §5.2, §5.4, §5.5.
 * Pure: no I/O, no clock unless passed in. The only place email or hosted HTML is produced.
 * Document shell, header, intro, signature and compliance footer follow the markup source of truth
 * `dreamlease-offer-mailer` v5 (14 Sept 2026); cards are in cards.ts.
 */
import type { Brochure, Campaign, ComplianceBlock, Rendered, Template, TemplateLayout } from '@offer-mailer/schema';
import { assertNoCapId, availableSecondaryContacts, SECONDARY_CONTACT_LABELS } from '@offer-mailer/schema';
import type { ContactMethod } from '@offer-mailer/schema';
import { heroCard, rowCard } from './cards.js';
import { C, FF, FONT, LH, esc, mso, paragraphs, table } from './html.js';
import { EMAIL_WIDTH, HEADSHOT, LOGO_H, LOGO_W, SIDE } from './layout.js';
import { Links } from './links.js';
import { RenderError, buildCards, type CardVM } from './viewmodel.js';

export { RenderError };

/** Bump when the markup changes in a way Emma should re-approve. 2 = the v5 reference markup. */
export const MARKUP_VERSION = 2;

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
 * auto: 1 → single, 2 or more → stack: one offer per row (Matt, 21 Sept 2026). Side-by-side cards crowded
 * the email and were the hard part to get right in every client: Outlook mobile kept two columns, and the
 * rows came out uneven. The two-up / three-up grid cards were deleted on 22 Sept once Matt had confirmed the
 * stacked layout in Gmail and Outlook; the schema still accepts 'grid2' / 'grid3' so a campaign stored with
 * one still parses, and it renders as the stacked layout.
 */
export function resolveLayout(layout: Campaign['layout'], offerCount: number): TemplateLayout {
  if (layout === 'single' || layout === 'stack') return layout;
  return offerCount === 1 ? 'single' : 'stack';
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

/** Head styles from the reference: resets, link-colour locks, forced light, and the enhancement-only media query. */
export const STYLE = `  /* Resets — enhancement only, no layout depends on this block. */
  html, body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
  body { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; background-color: ${C.ground}; }
  table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
  a { text-decoration: underline; }
  p { margin: 0; }
  .appleLinks a { color: ${C.graphite} !important; text-decoration: none !important; }
  /* Gmail/Apple auto-link colour lock */
  a[x-apple-data-detectors], u + #body a, #MessageViewBody a {
    color: inherit !important; text-decoration: none !important; font-size: inherit !important;
    font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important;
  }
  /* Forced light — Outlook mobile / Apple Mail inversion */
  [data-ogsc] .lock-bg, [data-ogsb] .lock-bg { background-color: ${C.white} !important; }
  [data-ogsc] .lock-tint, [data-ogsb] .lock-tint { background-color: ${C.panel} !important; }
  [data-ogsc] .lock-ink { color: ${C.black} !important; }
  [data-ogsc] .lock-body { color: ${C.graphite} !important; }
  [data-ogsc] .lock-red { color: ${C.red} !important; }
  [data-ogsc] .lock-white { color: ${C.white} !important; }

  /* Progressive enhancement. Cards already wrap without this. */
  @media only screen and (max-width: 480px) {
    .wrapper { width: 100% !important; }
    .gutter { padding-left: 16px !important; padding-right: 16px !important; }
    .stack-col { max-width: 100% !important; width: 100% !important; }
    .fluid-img { width: 100% !important; height: auto !important; max-width: 100% !important; }
    .cta-btn a { white-space: normal !important; }
  }`;

const MSO_HEAD = `<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<style type="text/css">
  * { font-family: ${FONT} !important; }
  table { border-collapse: collapse !important; mso-table-lspace: 0pt !important; mso-table-rspace: 0pt !important; }
  td, p, a, span { mso-line-height-rule: exactly; }
</style>
<![endif]-->`;

function preheader(campaign: Campaign): string {
  if (!campaign.preheader) return '';
  return `<!-- Preheader -->
<div style="display:none; font-size:1px; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">
  ${esc(campaign.preheader)}
  ${'&nbsp;&zwnj;'.repeat(30)}
</div>
`;
}

function emailDocument(campaign: Campaign, body: string): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${esc(campaign.subject)}</title>
${MSO_HEAD}
<style type="text/css">
${STYLE}
</style>
</head>

<body id="body" style="margin:0; padding:0; background-color:${C.ground};">

${preheader(campaign)}<!-- Outer background -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.ground};">
<tr>
<td align="center" style="padding:32px 8px;">

${mso(`\n<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${EMAIL_WIDTH}" align="center"><tr><td>\n`)}

${body}

${mso('\n</td></tr></table>\n')}

</td>
</tr>
</table>

</body>
</html>
`;
}

function hostedDocument(campaign: Campaign, body: string): string {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light only">
<title>${esc(campaign.subject)} · DreamLease</title>
<style type="text/css">
${STYLE}
  body { font-family: ${FONT}; }
</style>
</head>
<body style="margin:0; padding:0; background-color:${C.ground};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.ground};">
<tr>
<td align="center" style="padding:32px 8px;">
${body}
</td>
</tr>
</table>
</body>
</html>
`;
}

// ---------- email body ----------

interface BodyCtx {
  base: string;
  hostedUrl: string;
  links: Links;
  forHostedPage: boolean;
}

const bodyP = (text: string, size: number, lh: number, margin: string, extra = '') =>
  `<p class="lock-body" style="margin:${margin}; ${extra}font-size:${size}px; line-height:${lh}px; ${LH}; color:${C.graphite};">${text}</p>`;

function emailBody(campaign: Campaign, template: Template, cards: CardVM[], layout: TemplateLayout, compliance: ComplianceBlock, ctx: BodyCtx): string {
  const viewOnline = ctx.forHostedPage
    ? ''
    : `<tr>
          <td align="right" class="lock-body" style="padding-bottom:14px; ${FF} font-size:12px; line-height:16px; ${LH}; color:${C.graphite};">
            <a href="${esc(ctx.hostedUrl)}" style="color:${C.red}; text-decoration:underline;" class="lock-red">View these offers online</a>
          </td>
        </tr>
        `;

  const header = `  <!-- Header -->
  <tr>
    <td class="gutter" style="padding:20px ${SIDE}px 0 ${SIDE}px;">
      ${table(
        'width="100%"',
        '',
        `
        ${viewOnline}<tr>
          <td style="padding-bottom:20px; border-bottom:1px solid ${C.border};">
            <img src="${esc(ctx.base)}/a/logo-2x.png" width="${LOGO_W}" height="${LOGO_H}" alt="DreamLease" style="display:block; border:0; width:${LOGO_W}px; height:${LOGO_H}px;" />
          </td>
        </tr>
      `,
      )}
    </td>
  </tr>`;

  // The recipient greeting is personalisation for the salesperson's own email only — never on the public hosted
  // page (data minimisation: no customer name on a shareable URL).
  const greeting = !ctx.forHostedPage && campaign.recipient?.firstName ? `<p class="lock-ink" style="margin:0 0 14px 0; font-size:22px; line-height:28px; ${LH}; font-weight:bold; color:${C.black};">Hi ${esc(campaign.recipient.firstName)},</p>\n` : '';
  const intro = `  <!-- Intro -->
  <tr>
    <td class="gutter" style="padding:28px ${SIDE}px 8px ${SIDE}px; ${FF}">
${greeting}${paragraphs(campaign.intro, `margin:0 0 14px 0; font-size:16px; line-height:26px; ${LH}; color:${C.graphite};`, 'lock-body')}
    </td>
  </tr>`;

  const offersHtml = `<tr>\n<td class="gutter" style="padding:12px ${SIDE}px 0 ${SIDE}px;">\n${cards.map(layout === 'single' ? heroCard : rowCard).join('\n')}\n</td>\n</tr>`;

  const s = campaign.sender;
  const sigEmail = ctx.links.track('sig-email', `mailto:${s.email}`);
  const headshot = s.headshotUrl
    ? `<td width="72" style="padding:22px 16px 0 0; vertical-align:top;">
            <img src="${esc(s.headshotUrl)}" width="${HEADSHOT}" height="${HEADSHOT}" alt="${esc(s.displayName)}" style="display:block; border:0; width:${HEADSHOT}px; height:${HEADSHOT}px; border-radius:50%;" />
          </td>
          `
    : '';
  // Secondary contact links (salesperson-chosen, §7.1): an optional row under the email in the signature.
  // Additive to the v5 reference — like the salsac blocks and the view-offer link — and opt-in, so the
  // fixture sender leaves it unset and diff-reference stays green. Render skips any method missing its field.
  const secondaryLink = (m: ContactMethod): { id: string; href: string } => {
    switch (m) {
      case 'call':
        return { id: 'sig-call', href: `tel:${(s.phone ?? '').replace(/\s+/g, '')}` };
      case 'whatsapp':
        return { id: 'sig-whatsapp', href: `https://wa.me/${(s.whatsapp ?? '').replace(/^\+/, '')}` };
      case 'email':
        return { id: 'sig-contact-email', href: `mailto:${s.email}` };
      case 'book':
        return { id: 'sig-book', href: s.bookingUrl ?? '' };
    }
  };
  const avail = availableSecondaryContacts(s);
  const secondaryMethods = (s.secondaryContacts ?? []).filter((m) => avail.includes(m));
  const secondaryLine = secondaryMethods.length
    ? '\n            ' +
      bodyP(
        secondaryMethods
          .map((m) => {
            const { id, href } = secondaryLink(m);
            return `<a href="${esc(ctx.links.track(id, href))}" style="color:${C.red}; text-decoration:underline;" class="lock-red">${esc(SECONDARY_CONTACT_LABELS[m])}</a>`;
          })
          .join(' &nbsp;&middot;&nbsp; '),
        14,
        22,
        '8px 0 0 0',
      )
    : '';
  const signature = `  <!-- Signature -->
  <tr>
    <td class="gutter" style="padding:8px ${SIDE}px 28px ${SIDE}px;">
      ${table(
        'width="100%"',
        `border-top:1px solid ${C.border};`,
        `
        <tr>
          ${headshot}<td style="padding:22px 0 0 0; vertical-align:top; ${FF}">
            <p class="lock-ink" style="margin:0 0 2px 0; font-size:16px; line-height:22px; ${LH}; font-weight:bold; color:${C.black};">${esc(s.displayName)}</p>
            ${s.jobTitle ? bodyP(esc(s.jobTitle), 14, 20, '0 0 8px 0') + '\n            ' : ''}${bodyP(`${s.phone ? `${esc(s.phone)}<br />\n              ` : ''}<a href="${esc(sigEmail)}" style="color:${C.red}; text-decoration:underline;" class="lock-red">${esc(s.email)}</a>`, 14, 22, '0')}${secondaryLine}
          </td>
        </tr>
      `,
      )}
    </td>
  </tr>`;

  const siteHref = ctx.links.track('footer-site', 'https://www.dreamlease.co.uk');
  const footer = `  <!-- Compliance footer — locked block, do not edit per send -->
  <tr>
    <td class="gutter" style="padding:0 ${SIDE}px ${SIDE}px ${SIDE}px;">
      ${table(
        'width="100%"',
        '',
        `
        <tr>
          <td class="lock-tint" style="background-color:${C.panel}; border-radius:12px; padding:20px; ${FF}">
            <p style="margin:0 0 10px 0; font-size:11px; line-height:14px; ${LH}; font-weight:bold; letter-spacing:1px; text-transform:uppercase; color:${C.ink};">${esc(compliance.title.toUpperCase())}</p>
            ${compliance.paragraphs.map((p) => bodyP(esc(p), 12, 18, '0 0 8px 0')).join('\n            ')}
            ${table(
              'width="100%"',
              `margin-top:12px; border-top:1px solid ${C.border};`,
              `
              <tr><td style="padding-top:12px;">
                ${bodyP(esc(template.footer.optOutLine), 12, 18, '0', FF + ' ')}
                ${bodyP(`${esc(template.footer.companyLine)} <a href="${esc(siteHref)}" style="color:${C.graphite}; text-decoration:underline;" class="lock-body">dreamlease.co.uk</a>`, 11, 16, '8px 0 0 0', FF + ' ')}
              </td></tr>
            `,
            )}
          </td>
        </tr>
      `,
      )}
    </td>
  </tr>`;

  // A FLUID wrapper: full width up to 600px. The reference fixed it at 600px and left the media query to make
  // it fluid on phones, but the style block does not survive the New Outlook paste, so Outlook mobile shrank
  // the whole 600px layout to fit instead of reflowing it (Matt's test of 21 Sept: two columns on a phone).
  // Classic Outlook still gets its 600px from the ghost table around this one.
  return `<!-- ================= EMAIL WRAPPER ${EMAIL_WIDTH} ================= -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="wrapper lock-bg" style="width:100%; max-width:${EMAIL_WIDTH}px; background-color:${C.white}; ${FF} color:${C.graphite};">

${header}

${intro}

${offersHtml}

${signature}

${footer}

</table>
<!-- ================= /EMAIL WRAPPER ================= -->`;
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
  lines.push(s.displayName, ...(s.jobTitle ? [s.jobTitle] : []), ...(s.phone ? [s.phone] : []), s.email);
  const textSecondary: Record<ContactMethod, string> = { call: s.phone ?? '', whatsapp: s.whatsapp ?? '', email: s.email, book: s.bookingUrl ?? '' };
  for (const m of (s.secondaryContacts ?? []).filter((x) => availableSecondaryContacts(s).includes(x))) lines.push(`${SECONDARY_CONTACT_LABELS[m]}: ${textSecondary[m]}`);
  lines.push('');
  lines.push(compliance.title.toUpperCase(), ...compliance.paragraphs, '', template.footer.optOutLine, template.footer.companyLine, 'https://www.dreamlease.co.uk');
  return lines.join('\n');
}
