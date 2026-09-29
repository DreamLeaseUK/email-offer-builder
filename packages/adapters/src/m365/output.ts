/**
 * The m365 OfferOutput: delivers a rendered campaign from the salesperson's own mailbox (rule 4, as decided on
 * 29 Sept 2026). The caller (apps/api) has already run the pre-send checks and obtained an access token for the
 * Access-verified salesperson; this adapter only sends. One recipient per email: never bulk from a personal mailbox.
 */
import type { DeliveryInput, DeliveryResult, OfferOutput } from '../types.js';
import type { M365Client } from './client.js';
import { M365Error } from './client.js';

export interface M365OutputDeps {
  client: M365Client;
  /** An access token for the salesperson, from M365Client.refresh. */
  accessToken: string;
  now?: () => Date;
}

export function createM365Output(d: M365OutputDeps): OfferOutput {
  return {
    kind: 'm365',
    async deliver({ rendered, sender, to }: DeliveryInput): Promise<DeliveryResult> {
      if (sender.kind !== 'user') throw new M365Error('rejected', 'Only a salesperson sends from their own mailbox.', 'shared_sender');
      if (!to?.address) throw new M365Error('rejected', 'The email needs one recipient.', 'no_recipient');
      await d.client.sendMail(d.accessToken, { subject: rendered.subject, html: rendered.html, to: [to] });
      return { kind: 'm365', deliveredAt: (d.now?.() ?? new Date()).toISOString() };
    },
  };
}
