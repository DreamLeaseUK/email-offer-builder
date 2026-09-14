/**
 * API tests run inside workerd with real local bindings (D1 with the migrations applied, R2, the
 * Images binding in its offline low-fidelity mode). Outbound fetches are stubbed per test; nothing
 * reaches the real dreamlease.co.uk or Firecrawl.
 *
 * The pool ships its own workerd, which can trail the one wrangler deploys with; the compatibility
 * date here is the newest that binary supports and applies to tests only (wrangler.jsonc rules
 * production). Bump both together.
 */
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations(path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        compatibilityDate: '2026-08-22',
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
