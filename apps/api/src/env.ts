export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  HOSTED: R2Bucket;
  BROCHURES: R2Bucket;
  ASSETS: Fetcher;
  /** Cloudflare Images binding; optional so a missing binding degrades to "no image" rather than a crash. */
  TRANSFORM?: ImagesBinding;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** Origin serving /r, /c, /b, /f and /a (workers.dev now, offers.dreamlease.co.uk later). */
  PUBLIC_BASE_URL: string;
  TOOL_BASE_URL: string;
  APP_VERSION?: string;
  /** .dev.vars only; ignored whenever ACCESS_AUD is set. */
  DEV_USER_EMAIL?: string;
  /** wrangler secret */
  FIRECRAWL_API_KEY?: string;
  /** Optional comma-separated master-admin emails, merged with config/admins.json (see roles.ts). */
  ADMIN_EMAILS?: string;
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
