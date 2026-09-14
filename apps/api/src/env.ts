export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  HOSTED: R2Bucket;
  BROCHURES: R2Bucket;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  HOSTED_BASE_URL: string;
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
