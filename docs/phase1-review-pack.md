# Phase 1 review pack — sending from the salesperson's own mailbox

For the part-time developer, before the Phase 1 deploy (Matt's decision 5, 29 Sept 2026). About 20 minutes. It covers
the one new security surface: the tool now holds, for each salesperson who connects, a Microsoft permission that can
send email as them. The plan is `docs/evolution.md` §6; the as-built design is `docs/architecture.md` B13; IT's side
is `docs/it-runbook-sign-in.md` Part D.

## What to look at (in this order)

| File | What it does | What to check |
|---|---|---|
| `packages/adapters/src/m365/client.ts` | Microsoft client: authorize URL, code redemption with PKCE, refresh, `/me`, `/me/sendMail` | Tenant endpoints, the five delegated scopes, no `from` on sendMail, errors carry no token |
| `apps/api/src/mail.ts` | Connect Outlook: `/api/mail/connect`, `/callback`, `/status`, `/disconnect`; `sendAs()` | State + PKCE sealed in an HttpOnly cookie bound to the Access user; the mailbox must be the Access user (at connect and every send); the return address is config, never the request |
| `apps/api/src/mail-crypto.ts` | AES-256-GCM seal/open, key from `MAIL_TOKEN_KEY` | Random 96-bit IV per value; additional data binds a token to its owner's email; open() fails closed |
| `apps/api/src/send.ts` | `/api/campaigns/{id}/checks` and `/send` | Creator-only, own signature; server re-render (no HTML from the browser); reservation against double sends; the customer's address never stored or logged |
| `apps/api/src/presend.ts` | The pre-send checks | The placeholder wording (no approver) can never be sent |
| `apps/api/migrations/0004_mail_connections.sql` | The new table | Additive only |

## The security properties, and the test that proves each

| Property | Test |
|---|---|
| Only the signed-in person's own mailbox can be connected | `send.test.ts` "refuses a Microsoft account that is not the signed-in person" |
| A sign-in started by one person cannot be finished by another, or replayed | `send.test.ts` "refuses a return with the wrong state, no cookie, or another person's cookie" |
| The stored permission is encrypted and cannot be moved to another row | `send.test.ts` "stores an encrypted permission…" (opens only under its own email) |
| Only the creator sends, and only with their own signature | `send.test.ts` "only the campaign's creator can check or send it" |
| Sent once; a double click cannot send twice | `send.test.ts` "…once only" (409); `claimSend` is a conditional update |
| Never sent twice when Microsoft gives no clear answer, or when recording the send fails | `send.test.ts` "never sends twice when Microsoft gives no clear answer", "a failure to record the last-sent time…", "a failure to record the send in the register…" |
| A shared local dev tunnel cannot send from the dev user's mailbox | `send.test.ts` "without sign-in (local development) sends only from a page on this PC" |
| A link on another site cannot re-connect someone who disconnected | `send.test.ts` "Connect Outlook from another site" |
| Unapproved wording never goes out | `send.test.ts` "refuses to send the placeholder wording"; `presend.test.ts` |
| The customer's address is not stored | `send.test.ts` searches every campaign and connection row for it |
| Graph never sends as anyone else | `m365.test.ts` "sends as the token's own user: no from" |
| A dead or changed-key permission asks to reconnect, never errors | `send.test.ts` "asks to reconnect…" (both cases) |

## Secrets and settings

- `MAIL_CLIENT_SECRET` (IT's Send app secret, 12 months) and `MAIL_TOKEN_KEY` (32 random bytes, base64) are Worker
  secrets, set by Matt; never in the repo or logs. `MAIL_TENANT_ID`, `MAIL_CLIENT_ID` and `MAIL_REDIRECT_URI` are
  `wrangler.jsonc` vars (not secret).
- Changing `MAIL_TOKEN_KEY` makes every stored permission unreadable: each salesperson is asked to connect again.
- Microsoft's refresh token lasts 90 days without use and rotates on every use; the tool stores the new one each time
  and deletes connections unused for 90 days.

## Known limits (accepted)

- A client secret, not a certificate (Matt's decision 6; Microsoft prefers certificates). Renewal is in the runbook.
- The local copy (`pnpm dev:live`) has no sign-in and runs on production data, as before; a local test send stores
  Matt's permission in production encrypted with the local key. Matt disconnects after the test.
- The Microsoft 202 means "accepted", not "delivered"; a bounce arrives in the salesperson's Outlook.
- A send with no clear answer from Microsoft stays reserved for good: the salesperson checks Sent Items and, if it
  did not go, creates the campaign again. The tool never retries a send.

## Review already done

An independent multi-angle review (correctness, security, the house rules, Microsoft's contract) ran on 29 Sept, with
a second reviewer reproducing each finding. Fixed before this pack: double sends after an unclear answer or a
bookkeeping failure, edits after Create not reaching the customer, the previous customer's address staying in the
field, Connect Outlook losing the draft, the dev-tunnel send, a cross-site Connect, 403 handling, and Copy in
Safari/Firefox.

## What we need from you

A yes, or a list of changes, on the files above. Nothing needs access to production.
