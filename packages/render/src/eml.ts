/**
 * Wrap a Rendered campaign as an .eml file. Opening it in Outlook renders the HTML through Outlook's
 * own engine, and the X-Unsent header makes classic Outlook open it as an editable, sendable draft,
 * which is the edit-then-send test in brief §8.2. Test tooling only; production delivery is Graph.
 */
import type { Campaign, Rendered } from '@offer-mailer/schema';

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

export function toEml(campaign: Campaign, rendered: Rendered, to: string): string {
  const boundary = `----=_offer_mailer_${campaign.id.slice(0, 8)}`;
  const from = `${campaign.sender.displayName} <${campaign.sender.email}>`;
  const subject = `=?UTF-8?B?${Buffer.from(rendered.subject, 'utf8').toString('base64')}?=`;
  return [
    'X-Unsent: 1',
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(rendered.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(rendered.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
