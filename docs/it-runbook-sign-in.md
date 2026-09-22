# IT runbook — sign-in for the DreamLease Offer Mailer (Cloudflare Access + Microsoft Entra ID)

Written 22 September 2026. Steps A1–A6 are for the Entra administrator; B1–B6 are for the Cloudflare account
holder (Matt). About 15 minutes each. Nothing here sends email or touches mailboxes; this is sign-in only.

## What it does

Staff open the tool and sign in with the Microsoft 365 work account they already have. Cloudflare Access checks
the sign-in with Entra ID, then passes each request to the tool with a signed token naming the user. The tool
verifies the token and uses the verified work email as the author of everything the user does. No new accounts,
no passwords stored anywhere in the tool, and leavers lose access when their M365 account is disabled. MFA and
conditional access already enforced in the tenant apply unchanged.

Until this is done the production tool refuses every request to `/api` (HTTP 503), by design.

## Before you start (Matt supplies to IT)

- The Cloudflare Zero Trust **team name**: Cloudflare dashboard → Zero Trust → Settings → Custom pages → Team
  name and domain. Zero Trust must be enabled on the account first (free plan, one-time setup).
- The tool's hostname. Today: `offer-mailer.matt-wilson-9b8.workers.dev`. A DreamLease subdomain can come later
  (Part C) and does not hold up sign-in.

## Part A — Entra administrator

**A1. Register the application.** Microsoft Entra admin center (entra.microsoft.com) → Identity → Applications →
App registrations → New registration.

| Field | Value |
|---|---|
| Name | `Cloudflare Access – DreamLease Offer Mailer` |
| Supported account types | Accounts in this organizational directory only (single tenant) |
| Redirect URI | Platform **Web**, URL `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback` |

Select Register.

**A2. Copy the identifiers.** On the app's Overview page copy the **Application (client) ID** and the
**Directory (tenant) ID**.

**A3. Create a client secret.** Certificates & secrets → Client secrets → New client secret. Description
`Cloudflare Access`; expiry 24 months. Copy the secret **Value** immediately; it is shown once. Diary the expiry
date: when it lapses nobody can sign in until a new secret is issued and given to Cloudflare.

**A4. API permissions.** API permissions → Add a permission → Microsoft Graph → **Delegated** permissions:

- `openid`
- `email`
- `profile`
- `offline_access`
- `User.Read`

Then **Grant admin consent** for the tenant. These five are enough for sign-in with policies written by email
address or domain. Add `Directory.Read.All` and `GroupMember.Read.All` only if the Access policy is to be written
by Entra group; that is the full set Cloudflare tests and supports.

**A5. Optional, recommended: restrict who can start a sign-in.** Identity → Applications → Enterprise
applications → the same app → Properties → **Assignment required?** Yes. Then Users and groups → assign the sales
team group (or the individuals). Cloudflare's own policy in B3 is the second gate; this makes Entra the first.

**A6. Hand over to Matt, not in plain-text email:** the Application (client) ID, the Directory (tenant) ID, the
client secret value, and the secret's expiry date.

## Part B — Cloudflare (Matt)

**B1.** Zero Trust is enabled on the account (Cloudflare dashboard → Zero Trust; the free plan).

**B2. Add Entra as the identity provider.** Zero Trust → Integrations → Identity providers → Add new identity
provider → **Azure AD** (Microsoft Entra ID). Paste the Application ID, the client secret and the Directory ID.
Save, then **Test**: a Microsoft sign-in should complete and report success.

**B3. Protect the tool, and only the tool.** The Worker also serves customer-facing pages (hosted offer pages,
tracked links, brochures, images) that must open without any login, so Access is applied to the `/api` path,
not to the whole Worker. Zero Trust → Access → Applications → Add an application → **Self-hosted**:

| Field | Value |
|---|---|
| Application name | `DreamLease Offer Mailer` |
| Session duration | 24 hours |
| Application domain | `offer-mailer.matt-wilson-9b8.workers.dev` with path `api` |
| Identity providers | Entra ID only; turn on **Instant Auth** so users go straight to Microsoft |
| Policy | Name `DreamLease staff`, action **Allow**, include **Emails ending in** `@dreamlease.co.uk` (or the Entra group from A5) |

Save. When the web app is later served from the Worker, add its path to the same application (Add domain).
Do not use the Worker-level "Protect this Worker behind Access" with all traffic: it would put a login page in
front of the customer links.

**B4. Copy two values from the new application:** the **Application Audience (AUD) tag** (application →
Overview) and the team domain `<team-name>.cloudflareaccess.com`.

**B5. Give them to the Worker.** In `apps/api/wrangler.jsonc` set `ACCESS_TEAM_DOMAIN` to
`<team-name>.cloudflareaccess.com` and `ACCESS_AUD` to the tag, then `pnpm run deploy`. With `ACCESS_AUD` set,
the tool accepts a request to `/api` only when it carries a valid Access token for that audience; the local
development bypass is inert in production.

**B6. Test.** In a private browser window open `https://offer-mailer.matt-wilson-9b8.workers.dev/api/me`: a
Microsoft sign-in, then a small JSON reply showing your email and role. A colleague not covered by the policy
is refused. Then confirm `/health` and a hosted page (`/c/<slug>`) still open with no login at all.

## Part C — later, not needed for sign-in: a DreamLease subdomain

Customer links currently use the `workers.dev` hostname. To put the tool and the links on a DreamLease subdomain,
that hostname must be on a Cloudflare zone. DNS for `dreamlease.co.uk` is at GoDaddy, which leaves two options:

1. Move DNS for `dreamlease.co.uk` to Cloudflare (full setup; free plan; GoDaddy stays the registrar; every
   existing record is recreated in Cloudflare before the nameservers change).
2. Keep GoDaddy as DNS and proxy just the one subdomain through Cloudflare (CNAME / partial setup). Cloudflare
   offers this on the Business plan and above only.

`mailer.dreamlease.co.uk` is already in use elsewhere; `offers.dreamlease.co.uk` is free. This is a decision for
Matt and IT and it does not block sign-in.

## Ongoing

- **Client secret renewal** (Entra admin): before the expiry set in A3, issue a new secret and give it to Matt,
  who updates the identity provider in Cloudflare (B2). Missing this locks everyone out of the tool until done.
- **Leavers**: disable the M365 account. Their Access session ends at the next check (sessions last 24 hours by
  B3; Zero Trust → Access → Applications → Revoke existing tokens ends them at once).
- **What flows where**: Entra gives Cloudflare the user's name and work email (and group membership only if the
  group permissions are granted). The tool receives the email. Nothing is written back to Entra. There is no
  second Entra app: the "create draft in Outlook" idea that would have needed one has been dropped.

## Data protection

Sign-in adds no customer data and creates no new GDPR issue; it removes two risks.

**What sign-in adds**

- Cloudflare receives the staff member's name and work email from Entra at each sign-in and keeps an Access log
  of sign-ins (time, IP address). Staff data in a business context, legitimate interest, under Cloudflare's
  processing terms. Customers never sign in.
- The tool receives the work email and records it as the author of each campaign and register entry, as it
  already does in development. Nothing new is stored.
- One cookie on the tool's hostname holds the Access session: strictly necessary, staff-only, no consent banner.

**What sign-in removes**

- The development bypass. Setting the audience tag (B5) closes the one route by which production could have
  been opened without a login.
- Any separate credential store. Access follows the M365 account, so joiners, leavers and MFA are handled where
  they already are.

**Keeping it minimal**

- Grant only the five permissions in A4. The two group permissions let Cloudflare read directory group
  membership; add them only if the policy is to be written by Entra group.
- Turn on Assignment required (A5), so only the sales group can start a sign-in at all.

**Compliance items that are not about sign-in.** Before the first real customer send: the live compliance
template is still a placeholder, not the approved wording (an FCA financial-promotions matter, not GDPR); the
production register holds test campaigns that should be wiped; and the retention period for campaign records is
still to be set. Sign-in can go live without any of these. Real sends should not.
