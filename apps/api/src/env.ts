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
}

export interface AccessUser {
  email: string;
  sub: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: AccessUser };
};
