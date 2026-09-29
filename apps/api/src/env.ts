export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  HOSTED: R2Bucket;
  BROCHURES: R2Bucket;
  ASSETS: Fetcher;
  /** Cloudflare Images binding; optional so a missing binding degrades to "no image" rather than a crash. */
  TRANSFORM?: ImagesBinding;
  /** Cloudflare Access team domain (wrangler.jsonc var): dreamlease.cloudflareaccess.com. */
  ACCESS_TEAM_DOMAIN: string;
  /**
   * The Access application's AUD tag. A PRODUCTION-ONLY secret (`wrangler secret put ACCESS_AUD`), never a
   * wrangler.jsonc var: a var would also reach `wrangler dev` and the tests, switching the local sign-in bypass off.
   * `wrangler dev --remote` (pnpm dev:live) carries the deployed Worker's secrets into its preview, so that script
   * blanks it with `--var ACCESS_AUD:` (seen 28 Sept: without it the local tool answered 401).
   * Absent = Access not configured: the dev bypass applies locally and production fails closed (503).
   */
  ACCESS_AUD?: string;
  /** Origin serving /r, /c, /b, /f and /a (workers.dev now, offers.dreamlease.co.uk once it is live). */
  PUBLIC_BASE_URL: string;
  /** The tool's own origin (marketingtools.dreamelectric.uk): the only host that serves the web app (ui.ts). */
  TOOL_BASE_URL: string;
  APP_VERSION?: string;
  /** .dev.vars only; ignored whenever ACCESS_AUD is set. */
  DEV_USER_EMAIL?: string;
  /** wrangler secret */
  FIRECRAWL_API_KEY?: string;
  /** Optional comma-separated master-admin emails, merged with config/admins.json (see roles.ts). */
  ADMIN_EMAILS?: string;
  /** Optional comma-separated compliance-approver emails, merged with config/compliance.json (see roles.ts). */
  COMPLIANCE_EMAILS?: string;
  /** Optional retention policy: purge campaign records older than N days (unset/0 = keep — see retention.ts). */
  RETENTION_CAMPAIGN_DAYS?: string;
  // ---- Sending from the salesperson's own mailbox (Phase 1; the Send app, docs/it-runbook-sign-in.md Part D) ----
  // All five must be set for Connect Outlook and Send to work; until then the tool offers Copy for Outlook only.
  /** Directory (tenant) ID (a wrangler.jsonc var; not a secret). */
  MAIL_TENANT_ID?: string;
  /** The Send app's Application (client) ID (a wrangler.jsonc var; not a secret). */
  MAIL_CLIENT_ID?: string;
  /**
   * The return address registered in runbook D4, exactly. Production: the wrangler.jsonc var. Locally (the web app on
   * localhost:5173) both local dev scripts pass http://localhost:5173/api/mail/callback with --var
   * (apps/api/package.json). Never derived from the request: the Vite proxy rewrites the Host header, so the Worker
   * cannot see the address the browser used.
   */
  MAIL_REDIRECT_URI?: string;
  /** wrangler secret: the Send app's client secret (runbook D5, renewed yearly). */
  MAIL_CLIENT_SECRET?: string;
  /**
   * wrangler secret: 32 random bytes, base64. Encrypts each salesperson's stored Microsoft permission (AES-GCM,
   * mail-crypto.ts). Generated and piped by Matt's command, never shown. If it changes, stored connections can no
   * longer be read and each salesperson is asked to reconnect (never an error).
   */
  MAIL_TOKEN_KEY?: string;
}

export interface AccessUser {
  email: string;
  sub: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: AccessUser };
};
