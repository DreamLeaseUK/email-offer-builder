export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  HOSTED: R2Bucket;
  BROCHURES: R2Bucket;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** Origin serving /r, /c, /b and /a (workers.dev now, offers.dreamlease.co.uk later). */
  PUBLIC_BASE_URL: string;
  TOOL_BASE_URL: string;
  APP_VERSION?: string;
  /** .dev.vars only; ignored whenever ACCESS_AUD is set. */
  DEV_USER_EMAIL?: string;
  /** wrangler secret */
  FIRECRAWL_API_KEY?: string;
}

export interface AccessUser {
  email: string;
  sub: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: AccessUser };
};
