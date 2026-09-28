# IT runbook — sign-in for the DreamLease Offer Mailer (Cloudflare Access + Microsoft Entra ID)

Written 22 September 2026; Part A revised 24 September 2026 (current Entra menu names, a 12-month secret, one
app registration only); Parts B and C revised 28 September 2026 (the tool's own address, the customer-link address,
the audience tag as a secret). Steps A1–A8 are for the Entra administrator; B1–B6 and C1–C7 are for the Cloudflare
account holder (Matt); C8 is two DNS records for whoever manages DreamLease DNS at GoDaddy. Nothing here sends email or
touches mailboxes.

## What it does

Staff open the tool and sign in with the Microsoft 365 work account they already have. Cloudflare Access checks
the sign-in with Entra ID, then passes each request to the tool with a signed token naming the user. The tool
verifies the token and uses the verified work email as the author of everything the user does. No new accounts,
no passwords stored anywhere in the tool, and leavers lose access when their M365 account is disabled. MFA and
conditional access already enforced in the tenant apply unchanged.

Until this is done the production tool refuses every request to `/api` (HTTP 503), by design.

## Before you start (Matt supplies to IT)

- The Cloudflare Zero Trust **team name**: **`dreamlease`** (team domain `dreamlease.cloudflareaccess.com`; confirmed
  by Matt from Cloudflare dashboard → **Zero Trust** → **Settings** → **Team name and domain**, 24 Sept 2026). IT
  cannot finish A4 without it. If it is ever renamed, the A4 address must change with it.
- The tool's hostname: **`marketingtools.dreamelectric.uk`** (decided 28 Sept 2026; `dreamelectric.uk` is a
  DreamLease domain already on our Cloudflare account, so no DNS change is needed for it). It does not change
  anything in Part A: the redirect address in A4 is Cloudflare's, not the tool's.

## Part A — Entra administrator

You need to be a **Global Administrator** or an **Application Administrator**. This is the **only** app
registration the tool needs: it is for sign-in and never reads, sends or touches mail (an Outlook-draft feature that
would have needed a second app was removed from the plan on 24 September 2026). Menu names below are those of the
Microsoft Entra admin center as of September 2026; where Microsoft has used another wording, it is in brackets.

**A1. Open the admin center.** Go to **https://entra.microsoft.com** and sign in with your admin account.

**A2. Start a new app registration.** Left menu: **Entra ID** → **App registrations** → **New registration**.

**A3. Fill in the form.**

| Field | Enter or choose |
|---|---|
| Name | `Cloudflare Access - DreamLease Offer Mailer` |
| Supported account types | **Single tenant only – DreamLease** (older screens: *Accounts in this organizational directory only*) |
| Redirect URI, if the page shows one | Leave it empty; A4 adds it |

Select **Register**. The app's **Overview** page opens.

**A4. Add the sign-in return address.** Under **Manage**, select **Authentication** → **Add Redirect URI** (older
screens: *Add a platform*) → the **Web** tile. Paste the address below exactly, then select **Configure**.

```
https://dreamlease.cloudflareaccess.com/cdn-cgi/access/callback
```

**A5. Create a client secret.** **Certificates & secrets** → **Client secrets** tab → **New client secret**.
Description `Cloudflare Access`; expires **365 days (12 months)** (Microsoft recommends under 12 months; 24 is the
maximum). Select **Add**, then copy the **Value** column straight away, not the Secret ID: it is shown only once. If
the page is left before it is copied, delete that secret and make another. Note the expiry date. Microsoft's notice
recommending certificates instead of secrets does not apply here: Cloudflare Access's Entra connector uses a secret.

**A6. Permissions and consent.** **API permissions**: `User.Read` is already listed. **Add a permission** →
**Microsoft Graph** → **Delegated permissions** → tick `openid`, `email`, `profile` and `offline_access` → **Add
permissions** → **Grant admin consent for DreamLease** → **Yes**. Check that all five show **Granted for
DreamLease** under **Status**.

These five are enough when the Access policy is written by email address or domain. Add `Directory.Read.All` and
`GroupMember.Read.All` only if the policy is to be written by Entra group (together that is the full set Cloudflare
tests and supports).

**A7. Recommended: restrict who can start a sign-in.** **Entra ID** → **Enterprise apps** → **Cloudflare Access -
DreamLease Offer Mailer** → **Properties** → **Assignment required?** **Yes** → **Save**. Then **Users and groups** →
**Add user/group** → the sales team group (or the individuals) → **Assign**. Cloudflare's own policy in B3 is the
second gate; this makes Entra the first.

**A8. Hand over to Matt.**

| Value | Where it is | How to send it |
|---|---|---|
| Application (client) ID | the app's **Overview** page | email is fine |
| Directory (tenant) ID | the app's **Overview** page | email is fine |
| Client secret **Value** | copied in A5 | **not** by plain-text email: a call or a password manager |
| Secret expiry date | shown in A5 | email is fine; diary it (see Ongoing) |

## Part B — Cloudflare (Matt)

**B1.** Zero Trust is enabled on the account (Cloudflare dashboard → Zero Trust; the free plan).

**B2. Add Entra as the identity provider.** Zero Trust → Integrations → Identity providers → Add new identity
provider → **Azure AD** (Microsoft Entra ID). Paste the Application ID, the client secret and the Directory ID.
Save, then **Test**: a Microsoft sign-in should complete and report success.

**B3. Protect the tool's whole address, and nothing else.** The tool (web app and `/api`) has its own hostname,
`marketingtools.dreamelectric.uk`, so Access covers that whole host. The customer-facing pages (hosted offer pages,
tracked links, brochures, images) are served on other hostnames and must open without any login. Zero Trust →
Access → Applications → Add an application → **Self-hosted**:

| Field | Value |
|---|---|
| Application name | `DreamLease Offer Mailer` |
| Session duration | 24 hours |
| Application domain | `marketingtools.dreamelectric.uk`, path left **empty** (the whole host) |
| Identity providers | Entra ID only; turn on **Instant Auth** so users go straight to Microsoft |
| Policy | Name `DreamLease staff`, action **Allow**, include **Emails ending in** `@dreamlease.co.uk` (or the Entra group from A7) |

Save. It is fine to do this before the address exists (C5): the host is then protected from its first request.
Do not use the Worker-level "Protect this Worker behind Access" with all traffic: it would put a login page in
front of the customer links.

**B4. Copy the Application Audience (AUD) tag** from the new application (application → Overview). The team
domain `dreamlease.cloudflareaccess.com` is already in `apps/api/wrangler.jsonc`.

**B5. Give the tag to the Worker, as a secret.** Only after a deploy of the 28 Sept code (C7), which removes the
old empty `ACCESS_AUD` setting that would clash with the secret's name. In the desktop app's Terminal panel, from
the repo folder:

```
pnpm --filter @offer-mailer/api exec wrangler secret put ACCESS_AUD
```

Paste the tag when asked. It takes effect at once, no deploy needed. With `ACCESS_AUD` set, the tool accepts a
request to `/api` only when it carries a valid Access token for that audience, on any hostname; the local
development bypass is inert in production. (It is a secret, not a setting in `wrangler.jsonc`, so that local
development and the tests keep their bypass without anyone editing the file.)

**B6. Test.** In a private browser window open `https://marketingtools.dreamelectric.uk/`: a Microsoft sign-in, then
the tool. `https://marketingtools.dreamelectric.uk/api/me` shows your email and role. A colleague not covered by the
policy is refused. Then confirm the customer side still opens with no login at all: `/health` and a hosted page
(`/c/<slug>`) on `offer-mailer.matt-wilson-9b8.workers.dev` (and on `offers.dreamlease.co.uk` once Part C is
done). The tool is not served there: `/api/me` on those hosts answers 401 and `/app/` answers 404.

## Part C — the two addresses (Matt, plus two DNS records at GoDaddy)

Decided by Matt on 28 Sept 2026, after finding that `dreamlease.co.uk` cannot be put on our Cloudflare account
without moving its DNS (the main site and its certificates are run by MotorComplete through their own Cloudflare
account, and proxying one subdomain from GoDaddy DNS needs Cloudflare's Business plan):

- **The tool** goes on **`marketingtools.dreamelectric.uk`**. Staff only, behind Access; the domain does not matter
  to customers, and `dreamelectric.uk` is already a full zone on our account.
- **Customer links** go on **`offers.dreamlease.co.uk`**, so customers only ever see the DreamLease domain. It is
  attached with **Cloudflare for SaaS** on the `dreamelectric.uk` zone: GoDaddy keeps DreamLease's DNS, two records
  are added there, and nothing about `www`, the main site, email (MX) or MotorComplete's records changes. Free for
  the first 100 hostnames; we need one.

In the Cloudflare dashboard, zone **`dreamelectric.uk`**:

**C1. Turn on custom hostnames.** SSL/TLS → **Custom Hostnames** → **Enable Cloudflare for SaaS**. If it asks for a
payment method, one hostname is inside the free allowance.

**C2. Create the landing record.** DNS → Records → Add record: type **AAAA**, name **`saas`**, IPv6 address
**`100::`**, proxy status **Proxied** (orange cloud). `100::` is Cloudflare's "no server behind this" address; the
Worker answers instead.

**C3. Make it the fallback origin.** SSL/TLS → Custom Hostnames → **Fallback Origin**: `saas.dreamelectric.uk` →
**Add Fallback Origin**. Wait for it to show **Active** (a minute or two).

**C4. Add the customer address.** Custom Hostnames → **Add Custom Hostname**: `offers.dreamlease.co.uk`; leave the
certificate options at their defaults (HTTP validation). Save. The row shows a **hostname pre-validation TXT record**
(name `_cf-custom-hostname.offers.dreamlease.co.uk` and a value): copy both for C8.

**C5. Attach the tool's address.** Workers & Pages → **offer-mailer** → Settings → **Domains & Routes** → **Add** →
**Custom domain**: `marketingtools.dreamelectric.uk` → Add. Cloudflare creates its DNS record and certificate.

**C6. Send the customer address to the Worker.** Back in the `dreamelectric.uk` zone: **Workers Routes** → **Add
route**: route **`offers.dreamlease.co.uk/*`**, Worker **offer-mailer** → Save.

C5 and C6 are made once in the dashboard and are deliberately not in `wrangler.jsonc` (a route there stops `pnpm
dev:live` from running the local code); a deploy leaves them in place.

**C7. Deploy the 28 Sept code** (Terminal panel, repo folder): `pnpm run deploy`. It builds the web app and deploys
the Worker. Then do B5.

**C8. For whoever manages DreamLease DNS at GoDaddy** (two records in the `dreamlease.co.uk` zone; nothing else
changes):

| Type | Name (host) | Value (points to) | TTL |
|---|---|---|---|
| CNAME | `offers` | `saas.dreamelectric.uk` | 1 hour (default) |
| TXT | `_cf-custom-hostname.offers` | the value copied in C4 | 1 hour (default) |

Within about an hour of both records existing, the custom hostname in C4 shows **Active** with an active
certificate. Test: `https://offers.dreamlease.co.uk/health` answers with no login. Then Claude changes
`PUBLIC_BASE_URL` to `https://offers.dreamlease.co.uk` and Matt deploys, so new emails link there. Links in emails
already sent keep working on the `workers.dev` address, which stays on.

## Ongoing

- **Client secret renewal** (Entra admin, every 12 months): before the expiry set in A5, make a new secret (A5
  again) and give it to Matt, who updates the identity provider in Cloudflare (B2). Missing this locks everyone out
  of the tool until done.
- **Leavers**: disable the M365 account. Their Access session ends at the next check (sessions last 24 hours by
  B3; Zero Trust → Access → Applications → Revoke existing tokens ends them at once).
- **What flows where**: Entra gives Cloudflare the user's name and work email (and group membership only if the
  group permissions are granted). The tool receives the email. Nothing is written back to Entra. There is no
  second Entra app: the "create draft in Outlook" idea that would have needed one was removed from the plan on
  24 September 2026 (the next delivery path is monday.com's email tool).

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

- Grant only the five permissions in A6. The two group permissions let Cloudflare read directory group
  membership; add them only if the policy is to be written by Entra group.
- Turn on Assignment required (A7), so only the sales group can start a sign-in at all.

**Compliance items that are not about sign-in.** Before the first real customer send: the live compliance
template is still a placeholder, not the approved wording (an FCA financial-promotions matter, not GDPR); the
production register holds test campaigns that should be wiped; and the retention period for campaign records is
still to be set. Sign-in can go live without any of these. Real sends should not.
