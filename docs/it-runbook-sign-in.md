# IT runbook — sign-in and sending for the DreamLease Offer Mailer (Cloudflare Access, Microsoft Entra ID, Microsoft 365)

Written 22 September 2026; Part A revised 24 September 2026 (current Entra menu names, a 12-month secret); Parts B
and C revised 28 September 2026 (the tool's own address, the customer-link address, the audience tag as a secret);
**Part D added 29 September 2026** (the Send app: the tool sends each email from the salesperson's own mailbox).
Steps A1–A8 and D1–D9 are for the Entra administrator; B1–B6 and C1–C7 are for the Cloudflare account holder (Matt);
C8 is the DNS record(s) for whoever manages DreamLease DNS at GoDaddy. Parts A–C never touch mailboxes (A and B are
sign-in, C is the web addresses); Part D is the only part that concerns mail.

## What it does

Staff open the tool and sign in with the Microsoft 365 work account they already have. Cloudflare Access checks
the sign-in with Entra ID, then passes each request to the tool with a signed token naming the user. The tool
verifies the token and uses the verified work email as the author of everything the user does. No new accounts,
no passwords stored anywhere in the tool, and leavers lose access when their M365 account is disabled. MFA and
conditional access already enforced in the tenant apply unchanged.

Sign-in has been live since 29 September 2026. (Before it was set up, the production tool refused every request to
`/api` with HTTP 503, by design.)

**Sending (Part D, decided 29 September 2026, being built).** Once built, the tool sends each offer email from the
salesperson's own mailbox through Microsoft 365, after the salesperson connects their Outlook once and presses Send.
It uses a second app registration that can send only as the person who connected, never as anyone else, and never
reads mail. Until then, salespeople keep using Copy for Outlook.

## Before you start (Matt supplies to IT)

- The Cloudflare Zero Trust **team name**: **`dreamlease`** (team domain `dreamlease.cloudflareaccess.com`; confirmed
  by Matt from Cloudflare dashboard → **Zero Trust** → **Settings** → **Team name and domain**, 24 Sept 2026). IT
  cannot finish A4 without it. If it is ever renamed, the A4 address must change with it.
- The tool's hostname: **`marketingtools.dreamelectric.uk`** (decided 28 Sept 2026; `dreamelectric.uk` is a
  DreamLease domain already on our Cloudflare account, so no DNS change is needed for it). It does not change
  anything in Part A: the redirect address in A4 is Cloudflare's, not the tool's.

## Part A — Entra administrator

You need to be a **Global Administrator** or an **Application Administrator**. This app registration is for
sign-in only: it never reads, sends or touches mail. Sending uses a second, separate registration (Part D, decided
29 September 2026). Menu names below are those of the Microsoft Entra admin center as of September 2026; where
Microsoft has used another wording, it is in brackets.

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
| Policy | Name `DreamLease staff`, action **Allow**, include **Emails ending in** `@dreamlease.co.uk` (or the Entra group from A7). **As built (29 Sept):** the existing **Staff** policy, shared with the SalSac Broker CRM application: emails ending in dreamlease.co.uk or salsac.co.uk (Matt: SalSac staff may use the tool). A change to Staff changes both applications. |

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

**C8. For whoever manages DreamLease DNS at GoDaddy** (the CNAME is the one that matters; the TXT is optional and
only makes activation immediate — Cloudflare validates the hostname by itself once the CNAME exists; nothing else
changes):

| Type | Name (host) | Value (points to) | TTL |
|---|---|---|---|
| CNAME | `offers` | `saas.dreamelectric.uk` | 1 hour (default) |
| TXT (optional) | `_cf-custom-hostname.offers` | the value copied in C4 | 1 hour (default) |

Within about an hour of both records existing, the custom hostname in C4 shows **Active** with an active
certificate. Test: `https://offers.dreamlease.co.uk/health` answers with no login. Then Claude changes
`PUBLIC_BASE_URL` to `https://offers.dreamlease.co.uk` and Matt deploys, so new emails link there. Links in emails
already sent keep working on the `workers.dev` address, which stays on.

**Living alongside MotorComplete (checked 28 Sept 2026).** The website `www` is a custom hostname on MotorComplete's
own Cloudflare account, exactly as `offers` is on ours. Each name is routed on its own, by where its DNS record
points, and an exact name like `offers` outranks any wildcard another account could add. On 28 Sept MotorComplete's
Cloudflare answered for `www` only (not `offers`, not the bare domain), and no `*.dreamlease.co.uk` certificate has
ever been issued. Leave their records (`www`, `_acme-challenge`, `_acme-challenge.www`, `_cf-custom-hostname.www`)
exactly as they are. Two rules for later:

- **If the domain's DNS ever moves from GoDaddy to Cloudflare** (its nameservers change, in any account), keep the
  `offers` record **DNS only** (grey cloud). Proxied, the route in C6 no longer runs the Worker for it.
- **If anyone ever adds CAA records** to `dreamlease.co.uk` (records limiting which certificate authorities may issue
  for it), they must allow `letsencrypt.org` and `pki.goog`, or the `offers` certificate stops renewing (and
  MotorComplete's `www` certificate, from Google Trust Services, would be at risk too). There are none today.

**Seen on go-live (29 Sept 2026).**

- *Microsoft says AADSTS50105, "not assigned to the application".* Step A7 is on: add the person (or their group) under
  Enterprise apps → Cloudflare Access - DreamLease Offer Mailer → Users and groups, or set **Assignment required?** to
  **No** (Cloudflare's policy still limits sign-in to the allowed email domains).
- *After sign-in the address shows another website (it was MotorComplete's password page).* Look at the zone's own
  Rules → Snippets, Workers Routes and Page Rules first: four Snippets from the MotorComplete test site were proxying
  every request on `dreamelectric.uk`. They are disabled; keep them off.
- *Someone has the wrong screens* (e.g. compliance without the Templates tab): the tool matches the exact sign-in
  address. Read it from Zero Trust → Team & Resources → Users and put that address in `config/compliance.json` or
  `config/admins.json`.

## Part D — the Send app (Entra administrator, about 20 minutes)

Decided by Matt on 29 September 2026. The tool will send each offer email **from the salesperson's own mailbox**, so
it sits in their Sent Items and replies come back to them. For that it needs a second app registration, separate from
the sign-in app in Part A. Each salesperson clicks **Connect Outlook** once in the tool and signs in with Microsoft.
From then on Microsoft lets the tool send email **only as that person**, and never lets it read anyone's mailbox or
send as anyone else. The tool adds its own rules on top: it sends only while that person is signed in to the tool,
only when they press **Send**, and never on its own. Each Send is one email to one customer; bulk mailings are not
sent from personal mailboxes.

You need one of these Entra roles: Global Administrator, Application Administrator or Cloud Application Administrator
(any of them can do every step here, including the consent in D6). Menu names are those of the Microsoft Entra admin
center as of September 2026, checked against Microsoft Learn; where Microsoft has used another wording, it is in
brackets.

**D1. Open the admin center.** Go to **https://entra.microsoft.com** and sign in with your admin account.

**D2. Start a new app registration.** Left menu: **Entra ID** → **App registrations** → **New registration**. This is
a new registration: leave the Part A app (`Cloudflare Access - DreamLease Offer Mailer`) as it is.

**D3. Fill in the form.**

| Field | Enter or choose |
|---|---|
| Name | `DreamLease Offer Mailer - Send` |
| Supported account types | **Single tenant only – DreamLease** (older screens: *Accounts in this organizational directory only*) |
| Redirect URI, if the page shows one | Leave it empty; D4 adds them |

Select **Register**. The app's **Overview** page opens.

**D4. Add the two return addresses.** Under **Manage**, select **Authentication** (on some screens *Authentication
(Preview)*). On the **Redirect URI configuration** tab, select **Add Redirect URI** (older screens: *Add a
platform*), then the **Web** tile (not *Single-page application*). Paste the address below exactly, leave
*Front-channel logout URL* empty, then select **Configure**.

```
https://marketingtools.dreamelectric.uk/api/mail/callback
```

Then add the second address the same way: **Add Redirect URI** → **Web** → paste → **Configure** (older screens: in
the Web section, **Add URI**, paste, **Save**).

```
http://localhost:5173/api/mail/callback
```

The second is for testing the tool on Matt's PC. Microsoft allows `http` for `localhost` addresses only. Both
addresses must now be listed under **Web**. Leave the **Access tokens** and **ID tokens** boxes unticked: they are on
the Authentication page's **Settings** tab, under *Implicit grant and hybrid flows* (older screens: lower down the
same page). They are unticked by default, so there is nothing to change.

**D5. Create a client secret.** **Certificates & secrets** → **Client secrets** tab → **New client secret**.
Description `Offer Mailer Send`; expires **365 days (12 months)**, the same as Part A (Microsoft recommends under 12
months; 24 is the maximum). Select **Add**, then copy the **Value** column straight away, not the Secret ID: it is
shown only once. If the page is left before it is copied, delete that secret and make another. Note the expiry date.
Microsoft's notice recommending a certificate instead has been noted: Matt chose a secret, renewed every year (see
Ongoing). If Microsoft refuses to create the secret (a message that a policy in your organisation blocks client
secrets or limits their lifetime), do not change the policy: skip the secret, carry on with D6–D9, and tell Matt the
exact message. The tool can be changed to use a certificate instead.

**D6. Permissions and consent.** **API permissions**: `User.Read` (Microsoft Graph, Delegated) is already listed.
**Add a permission** → **Microsoft Graph** → **Delegated permissions**. Do **not** choose *Application permissions*:
those would let the app send as anyone in the company. Use the search box to find and tick `Mail.Send`,
`offline_access`, `openid` and `email` (if a result sits in a closed group, select the group's name to open it).
Unlike Part A, do **not** tick `profile`. Then **Add permissions**. Then select **Grant admin consent for DreamLease**
→ **Yes**, and select **Refresh** if the **Status** column has not changed yet.

Check that the **Configured permissions** table shows exactly these five rows, each with **Type** *Delegated* and
**Status** *Granted for DreamLease* (DreamLease's tenant shows its name as **individual**, so the button reads *Grant admin
consent for individual* and the status *Granted for individual*: that is the same thing, as Emma's screenshot of
30 Sept shows):

| Permission | What it lets the tool do |
|---|---|
| `Mail.Send` | Send an email as the salesperson who connected, from their own mailbox |
| `offline_access` | Stay connected, so the salesperson does not sign in to Microsoft again before every send |
| `User.Read` | Read the salesperson's own name and email address, to check the mailbox is theirs |
| `openid` | The Microsoft sign-in itself |
| `email` | The Microsoft sign-in itself (their email address) |

Do not add `Mail.Send.Shared`, `Mail.Read`, `Mail.ReadWrite` or anything else. None of the five needs an
administrator by Microsoft's rules. Granting consent once means salespeople are not asked to approve the app
themselves, and they could not approve it at all if the tenant blocks users from consenting to apps.

**D7. Who can connect: nothing to do (recommended).** The setting below is already at **No**; leave it. The rest of this
step is only for someone who wants to turn it on. **Entra ID** → **Enterprise apps** → **All applications** →
search for **DreamLease Offer Mailer - Send** (or, on the Send app's registration **Overview**, select *Managed
application in local directory*) → **Properties** → **Assignment required?** Leave it at **No**. The sign-in app (A7)
already decides who can reach the tool, and the tool lets each person send only as themselves. If you do set it to
**Yes**, assign each salesperson individually under **Users and groups** (assigning a group needs Entra ID P1 or P2).
Anyone not assigned will see Microsoft's error AADSTS50105 when they click Connect Outlook.

**D8. One question for you.** If **Conditional Access** is not in your menu, answer "not found": the tenant then most
likely has no Conditional Access policies (they need Entra ID P1), and the first real Connect Outlook proves it either
way (Emma, 30 Sept: not found). Otherwise: does DreamLease have **Conditional Access** policies that cover Office 365 or all cloud
apps (for example "UK only", "company devices only", "require MFA", or a sign-in frequency)? To check: **Entra ID** →
**Conditional Access** → **Policies**, and look at those whose **State** is **On** (this page needs Global
Administrator, Global Reader, Security Reader or Conditional Access Administrator; if you cannot open it, say so).
Tell Matt their names and what they do, or "none". Do **not** add an exception for the tool: each salesperson meets
those policies when they click Connect Outlook, like any Microsoft sign-in, and Matt will test a send with your
policies in place.

**D9. Hand over to Matt.**

| Value | Where it is | How to send it |
|---|---|---|
| Application (client) ID | the Send app's **Overview** page (not the *Object ID* on the same page, and not the Part A app's ID) | email is fine |
| Directory (tenant) ID | the same **Overview** page (the same value as in Part A) | email is fine |
| Client secret **Value** | copied in D5 | **not** by plain-text email: a call or a password manager |
| Secret expiry date | shown in D5 | email is fine; diary it (see Ongoing) |
| What you did in D7 | left at **No**, or **Yes** with the names you assigned | email is fine |
| A screenshot of **API permissions** after D6 | the Send app's **API permissions** page | email is fine |
| Your answer to D8 | — | email is fine |

**What a salesperson then sees.** In the tool, step 3 (Your details): **Connect Outlook** → the usual Microsoft
sign-in (usually just a click, as they are already signed in) → back to the tool, "Outlook connected". From then on
**Send** is in step 6. If Microsoft ends the connection later (after about 90 days without use, a password reset by
an administrator in the Entra or Microsoft 365 admin center, a revoke of their sessions, or their account being
disabled), the tool asks them to connect Outlook again.

## Ongoing

- **Client secret renewal, sign-in app** (Entra admin, every 12 months): before the expiry set in A5, make a new
  secret (A5 again) and give it to Matt, who updates the identity provider in Cloudflare (B2). Missing this locks
  everyone out of the tool until done.
- **Client secret renewal, Send app** (Entra admin, every 12 months): before the expiry set in D5, make a new secret
  as in D5 with the description `Offer Mailer Send <year>`, and give it to Matt, who replaces it in the Worker (in the
  desktop app's Terminal panel, from the repo folder: `pnpm --filter @offer-mailer/api exec wrangler secret put
  MAIL_CLIENT_SECRET`, then paste the value when asked; no deploy needed). Do not delete the old secret until Matt
  confirms a test send works; then delete the old one only. Missing the renewal stops sending from the tool until
  done; Copy for Outlook still works.
- **Leavers**: disable the M365 account. Their Access session ends at the next check (sessions last 24 hours by
  B3; Zero Trust → Access → Applications → Revoke existing tokens ends them at once). From then on Microsoft refuses
  to renew the tool's connection to their mailbox; a connection renewed just before can last up to about an hour,
  which is why the Cloudflare revoke is the immediate stop. The tool deletes any connection unused for 90 days.
- **The testing address** `http://localhost:5173/api/mail/callback` (D4) works only on a PC running the tool's
  development copy. It stays for future testing; IT may remove it at any time, and Matt will ask for it back when it
  is needed.
- **What flows where**: the sign-in app gives Cloudflare the user's name and work email (and group membership only
  if the group permissions are granted); the tool receives the email. The Send app gives the tool, for each
  salesperson who connects, a permission to send as them, which the tool stores encrypted; the tool reads their own
  name and address to check the mailbox is theirs. Nothing is written back to Entra, and the tool never reads mail.

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

**What sending adds (Part D)**

- For each salesperson who clicks Connect Outlook, the tool stores their work email, Microsoft's permission to send
  as them (a refresh token, **encrypted** with a key only the tool's server holds), the permissions granted, and when
  they connected and last sent. Staff data in a business context. The token itself is never logged or shown to
  anyone, including the salesperson.
- It is used only by the tool, only as that salesperson and only while they are signed in to it: once when they
  connect, to confirm the Microsoft account is the one they signed in with, and after that only when they press Send
  and the tool's automatic checks pass. It cannot read mail or send as anyone else.
- The customer's email address is used for that one send and not stored by the tool, as now. The sent email is in
  the salesperson's Sent Items, under DreamLease's normal Microsoft 365 retention. No customer data goes to any new
  system: Microsoft 365 already holds DreamLease's email.
- Switching it off: the salesperson clicks **Disconnect Outlook** (the tool deletes its copy). For a leaver,
  disabling the account ends it, and the tool deletes any connection unused for 90 days. An administrator can end it
  for everyone at once with **Entra ID** → **Enterprise apps** → **DreamLease Offer Mailer - Send** → **Properties**
  → **Enabled for users to sign-in?** → **No** → **Save** (set it back to **Yes** to restore), or for one person with
  **Entra ID** → **Users** → the person → **Revoke sessions**. A salesperson changing their own password does not end
  it.

**Keeping it minimal**

- Grant only the five permissions in A6 and the five in D6. The two group permissions let Cloudflare read directory
  group membership; add them only if the policy is to be written by Entra group.
- Turn on Assignment required for the sign-in app (A7), so only the people assigned can start a sign-in at all.

**Compliance items that are not about sign-in.** Before the first real customer send: the live compliance
template is still a placeholder, not the approved wording (an FCA financial-promotions matter, not GDPR; once sending is
built, the tool's Send refuses it automatically until Emma publishes the approved wording); the production register holds test
campaigns that should be wiped; and the retention period for campaign records is still to be set. Sign-in can go
live without any of these. Real sends should not.
